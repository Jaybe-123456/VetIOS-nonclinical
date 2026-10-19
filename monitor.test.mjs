import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inspectMonitorConfiguration, runMonitor } from './monitor.mjs';
import { canonical, GOVERNANCE, ROUTES } from './policy.mjs';
import { sha256 } from './build.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const valid = () => {
  const members = [...new Set(Object.values(ROUTES))].sort().map(path => ({
    path, bytes: 3, sha256: 'a'.repeat(64)
  }));
  const core = { schema: 'vetios-nonclinical-artifact-v1',
    source_sha256: 'b'.repeat(64), members };
  const manifest = { ...core, artifact_sha256: sha256(canonical(core)),
    governance: GOVERNANCE, production_authorized: false };
  return { NONCLINICAL_MONITOR_DOMAIN: 'd123456.cloudfront.net',
    NONCLINICAL_MONITOR_MANIFEST: JSON.stringify(manifest) };
};

test('uncommissioned monitor identifies both missing settings without reaching the network', async () => {
  let called = false;
  const result = await runMonitor({}, async () => { called = true; });
  assert.equal(result.exitCode, 2);
  assert.equal(result.result.status, 'NOT_COMMISSIONED');
  assert.deepEqual(result.result.missing, ['NONCLINICAL_MONITOR_DOMAIN', 'NONCLINICAL_MONITOR_MANIFEST']);
  assert.equal(result.result.live_health_checked, false);
  assert.equal(called, false);
});

test('one missing setting stays NOT_COMMISSIONED and cannot report healthy', async () => {
  const result = await runMonitor({ NONCLINICAL_MONITOR_DOMAIN: 'd123456.cloudfront.net' },
    async () => { throw Error('should not run'); });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.result.missing, ['NONCLINICAL_MONITOR_MANIFEST']);
});

test('malformed JSON fails closed and never echoes raw input', () => {
  const env = valid();
  env.NONCLINICAL_MONITOR_MANIFEST = '{PRIVATE_SENTINEL';
  const parsed = inspectMonitorConfiguration(env);
  assert.equal(parsed.result.status, 'INVALID_CONFIGURATION');
  assert.equal(JSON.stringify(parsed).includes('PRIVATE_SENTINEL'), false);
});

test('tampered manifest, unauthorized status and wrong domain fail closed', () => {
  const env = valid();
  const tampered = JSON.parse(env.NONCLINICAL_MONITOR_MANIFEST);
  tampered.members[0].bytes++;
  env.NONCLINICAL_MONITOR_MANIFEST = JSON.stringify(tampered);
  assert.equal(inspectMonitorConfiguration(env).ready, false);
  const unauthorized = valid();
  const other = JSON.parse(unauthorized.NONCLINICAL_MONITOR_MANIFEST);
  other.production_authorized = true;
  unauthorized.NONCLINICAL_MONITOR_MANIFEST = JSON.stringify(other);
  assert.equal(inspectMonitorConfiguration(unauthorized).ready, false);
  const wrongDomain = valid();
  wrongDomain.NONCLINICAL_MONITOR_DOMAIN = 'not-cloudfront.example';
  assert.equal(inspectMonitorConfiguration(wrongDomain).ready, false);
});

test('valid commissioned configuration invokes only the injected read-only checker', async () => {
  const env = valid();
  assert.equal(inspectMonitorConfiguration(env).ready, true);
  const out = await runMonitor(env, async (config, manifest) => {
    assert.equal(config.domain, env.NONCLINICAL_MONITOR_DOMAIN);
    assert.equal(manifest.artifact_sha256, JSON.parse(env.NONCLINICAL_MONITOR_MANIFEST).artifact_sha256);
    return { status: 'TEST_HEALTHY' };
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.result.status, 'TEST_HEALTHY');
});

test('health exception remains failure and does not leak exception details', async () => {
  const result = await runMonitor(valid(), async () => { throw Error('private-provider-token'); });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.status, 'MONITOR_ERROR');
  assert.equal(JSON.stringify(result).includes('private-provider-token'), false);
});

test('scheduled entrypoint reports NOT_COMMISSIONED with nonzero exit', () => {
  const out = spawnSync(process.execPath, [join(root, 'monitor.mjs')],
    { encoding: 'utf8', env: { PATH: process.env.PATH, NONCLINICAL_MONITOR_DOMAIN: '', NONCLINICAL_MONITOR_MANIFEST: '' } });
  assert.equal(out.status, 2);
  assert.equal(JSON.parse(out.stderr).status, 'NOT_COMMISSIONED');
  assert.equal(out.stdout, '');
});

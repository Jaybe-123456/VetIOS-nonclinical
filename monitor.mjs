// Read-only HTTPS monitoring. Missing commissioning must never report healthy.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { canonical, GOVERNANCE, ROUTES, shaPattern } from './policy.mjs';
import { sha256 } from './build.mjs';
import { health } from './deploy.mjs';

const REQUIRED = Object.freeze(['NONCLINICAL_MONITOR_DOMAIN', 'NONCLINICAL_MONITOR_MANIFEST']);
const DOMAIN = /^d[a-z0-9]{5,40}\.cloudfront\.net$/;

export function inspectMonitorConfiguration(env) {
  const missing = REQUIRED.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) {
    return {
      ready: false,
      result: { status: 'NOT_COMMISSIONED', reason: 'required_monitor_configuration_missing',
        missing, live_health_checked: false }
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(env.NONCLINICAL_MONITOR_MANIFEST);
  } catch {
    return {
      ready: false,
      result: { status: 'INVALID_CONFIGURATION', reason: 'monitor_manifest_not_valid_json',
        live_health_checked: false }
    };
  }
  try {
    assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest));
    assert.equal(manifest.schema, 'vetios-nonclinical-artifact-v1');
    assert.equal(manifest.production_authorized, false);
    assert.deepEqual(manifest.governance, GOVERNANCE);
    assert.ok(typeof manifest.source_sha256 === 'string');
    assert.match(manifest.source_sha256, shaPattern);
    assert.ok(typeof manifest.artifact_sha256 === 'string');
    assert.match(manifest.artifact_sha256, shaPattern);
    assert.ok(Array.isArray(manifest.members));
    assert.deepEqual(manifest.members.map(m => m.path).sort(), [...new Set(Object.values(ROUTES))].sort());
    assert.equal(sha256(canonical({
      schema: manifest.schema, source_sha256: manifest.source_sha256, members: manifest.members
    })), manifest.artifact_sha256);
    assert.match(env.NONCLINICAL_MONITOR_DOMAIN, DOMAIN);
  } catch {
    return {
      ready: false,
      result: { status: 'INVALID_CONFIGURATION', reason: 'commissioned_manifest_or_domain_failed_validation',
        live_health_checked: false }
    };
  }
  return { ready: true, domain: env.NONCLINICAL_MONITOR_DOMAIN, manifest };
}

export async function runMonitor(env, healthCheck = health) {
  const config = inspectMonitorConfiguration(env);
  if (!config.ready) return { exitCode: 2, result: config.result };
  try {
    return { exitCode: 0, result: await healthCheck({ domain: config.domain }, config.manifest) };
  } catch {
    return { exitCode: 1, result: { status: 'MONITOR_ERROR',
      reason: 'live_health_check_failed', live_health_checked: true } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, result } = await runMonitor(process.env);
  const line = canonical(result) + '\n';
  if (exitCode === 0) process.stdout.write(line);
  else process.stderr.write(line);
  process.exitCode = exitCode;
}

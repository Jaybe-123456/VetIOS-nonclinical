// Read-only public probes. Commissioning and human alert acknowledgement are external evidence.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { canonical, GOVERNANCE, HEADERS, ROUTES, shaPattern } from './policy.mjs';
import { sha256 } from './build.mjs';

const fields = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort());
export function validateMonitorPolicy(policy) {
    fields(policy, ['schema', 'state', 'provider', 'domain']);
    assert.equal(policy.schema, 'vetios-nonclinical-monitor-policy-v1');
    assert.ok(['NOT_COMMISSIONED', 'COMMISSIONED'].includes(policy.state));
    if (policy.state === 'NOT_COMMISSIONED') {
        assert.equal(policy.provider, null); assert.equal(policy.domain, null);
    } else {
        assert.ok(['AWS_CLOUDFRONT', 'VERCEL'].includes(policy.provider));
        if (policy.provider === 'VERCEL') assert.equal(policy.domain, 'vetios-public-static.vercel.app');
        else assert.match(policy.domain, /^d[a-z0-9]{5,40}\.cloudfront\.net$/);
    }
    return policy;
}

export function validateMonitorManifest(raw, expectedDigest) {
    assert.ok(typeof raw === 'string' && Buffer.byteLength(raw) <= 64 * 1024);
    assert.match(expectedDigest, shaPattern);
    assert.equal(sha256(raw), expectedDigest, 'manifest bytes changed');
    const manifest = JSON.parse(raw);
    fields(manifest, ['schema', 'source_sha256', 'members', 'artifact_sha256', 'governance', 'production_authorized']);
    assert.equal(manifest.schema, 'vetios-nonclinical-artifact-v1');
    assert.equal(manifest.production_authorized, false); assert.deepEqual(manifest.governance, GOVERNANCE);
    assert.match(manifest.source_sha256, shaPattern); assert.match(manifest.artifact_sha256, shaPattern);
    assert.deepEqual(manifest.members.map(m => m.path).sort(), [...new Set(Object.values(ROUTES))].sort());
    for (const member of manifest.members) {
        fields(member, ['path', 'bytes', 'sha256']); assert.match(member.sha256, shaPattern);
        assert.ok(Number.isSafeInteger(member.bytes) && member.bytes > 0 && member.bytes <= 1024 * 1024);
    }
    const { schema, source_sha256, members } = manifest;
    assert.equal(sha256(canonical({ schema, source_sha256, members })), manifest.artifact_sha256);
    return manifest;
}

async function boundedBody(response, expectedBytes) {
    assert.ok(response.body, 'missing response body');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.length; assert.ok(length <= expectedBytes, 'oversized response'); chunks.push(value);
        }
    } finally { await reader.cancel(); }
    assert.equal(length, expectedBytes); return Buffer.concat(chunks);
}

export async function probePublicArtifact(policy, manifest, request = fetch) {
    const root = 'https://' + policy.domain;
    for (const [uri, file] of Object.entries(ROUTES)) for (const method of ['GET', 'HEAD']) {
        const member = manifest.members.find(m => m.path === file);
        const response = await request(root + uri, { method, redirect: 'error', signal: AbortSignal.timeout(10000) });
        try {
            assert.equal(response.status, 200);
            for (const [key, value] of Object.entries(HEADERS)) assert.equal(response.headers.get(key), value, 'header mismatch');
            assert.equal(response.headers.get('set-cookie'), null);
            if (method === 'GET') assert.equal(sha256(await boundedBody(response, member.bytes)), member.sha256);
        } finally { if (response.body && !response.body.locked) await response.body.cancel(); }
    }
    for (const [uri, method] of [['/api/inference', 'POST'], ['/api/outcomes', 'GET'], ['/admin', 'GET'], ['/api/federation', 'POST'], ['/', 'POST']]) {
        const response = await request(root + uri, { method, redirect: 'error', signal: AbortSignal.timeout(10000) });
        try { assert.equal(response.status, policy.provider === 'VERCEL' ? (uri === '/' ? 405 : 404) : 403); }
        finally { if (response.body) await response.body.cancel(); }
    }
    return { status: 'OBSERVED_HEALTHY', healthy: true, artifact_sha256: manifest.artifact_sha256 };
}

export async function runMonitor({ policy, env = process.env, request = fetch, now = () => new Date().toISOString() }) {
    const base = { schema: 'vetios-nonclinical-monitor-result-v1', observed_at: now(), healthy: null,
        production_authorized: false, clinical_production_release: 'BLOCKED' };
    let manifest;
    try {
        validateMonitorPolicy(policy);
        const domain = env.NONCLINICAL_MONITOR_DOMAIN ?? '';
        const raw = env.NONCLINICAL_MONITOR_MANIFEST ?? '';
        const digest = env.NONCLINICAL_MONITOR_MANIFEST_SHA256 ?? '';
        if (policy.state === 'NOT_COMMISSIONED') {
            // Deleting variables cannot reset the mandatory, source-controlled commissioning state.
            assert.ok(!domain && !raw && !digest, 'configuration supplied before commissioning');
            return { ...base, status: 'NOT_COMMISSIONED', network_attempted: false, exit_code: 0 };
        }
        assert.equal(domain, policy.domain); assert.ok(raw && digest, 'commissioned configuration missing');
        manifest = validateMonitorManifest(raw, digest);
    } catch {
        return { ...base, status: 'CONFIGURATION_ERROR', network_attempted: false, exit_code: 1 };
    }
    try {
        return { ...base, ...await probePublicArtifact(policy, manifest, request), network_attempted: true, exit_code: 0 };
    } catch {
        return { ...base, status: 'PROBE_FAILED', network_attempted: true, exit_code: 1 };
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    let policy;
    try { policy = JSON.parse(await fs.readFile(new URL('./monitor-policy.json', import.meta.url), 'utf8')); } catch { /* fail closed below */ }
    const result = await runMonitor({ policy });
    process.stdout.write(canonical(result) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
        `Non-clinical monitor: **${result.status}**. Public health: ${result.healthy === true ? 'observed for the configured artifact' : 'not established'}. This result grants no release authority.\n`);
    if (result.status !== 'OBSERVED_HEALTHY') process.stdout.write(`::${result.exit_code ? 'error' : 'notice'}::Non-clinical monitor ${result.status}; public health not established.\n`);
    process.exitCode = result.exit_code;
}

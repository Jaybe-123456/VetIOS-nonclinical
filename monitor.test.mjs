import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runMonitor } from './monitor.mjs';
import { canonical, GOVERNANCE, HEADERS, ROUTES } from './policy.mjs';
import { sha256 } from './build.mjs';

// Synthetic HTTP responses test monitor mechanics, never operational commissioning.
const uncommissioned = { schema: 'vetios-nonclinical-monitor-policy-v1', state: 'NOT_COMMISSIONED', provider: null, domain: null };
const commissioned = { ...uncommissioned, state: 'COMMISSIONED', provider: 'VERCEL', domain: 'vetios-public-static.vercel.app' };
const bodies = new Map([...new Set(Object.values(ROUTES))].map(name => [name, Buffer.from('synthetic monitor fixture: ' + name)]));
const core = { schema: 'vetios-nonclinical-artifact-v1', source_sha256: sha256('synthetic source'),
    members: [...bodies].map(([name, body]) => ({ path: name, bytes: body.length, sha256: sha256(body) })) };
const manifest = { ...core, artifact_sha256: sha256(canonical(core)), governance: GOVERNANCE, production_authorized: false };
const environment = (value = manifest, domain = commissioned.domain) => {
    const raw = typeof value === 'string' ? value : canonical(value);
    return { NONCLINICAL_MONITOR_DOMAIN: domain, NONCLINICAL_MONITOR_MANIFEST: raw, NONCLINICAL_MONITOR_MANIFEST_SHA256: sha256(raw) };
};
const noNetwork = () => { assert.fail('configuration must be checked before network access'); };
function healthyRequest(policy, calls = []) {
    return async (url, options) => {
        assert.equal(new URL(url).origin, 'https://' + policy.domain); assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal); calls.push([new URL(url).pathname, options.method]);
        const file = ROUTES[new URL(url).pathname];
        if (!file || options.method === 'POST') return new Response(null, { status: policy.provider === 'VERCEL' ? (file ? 405 : 404) : 403 });
        return new Response(options.method === 'HEAD' ? null : bodies.get(file), { status: 200, headers: HEADERS });
    };
}

test('empty GitHub variables before commissioning explicitly establish no health and make no request', async () => {
    for (const env of [{}, { NONCLINICAL_MONITOR_DOMAIN: '', NONCLINICAL_MONITOR_MANIFEST: '', NONCLINICAL_MONITOR_MANIFEST_SHA256: '' }]) {
        const result = await runMonitor({ policy: uncommissioned, env, request: noNetwork });
        assert.equal(result.status, 'NOT_COMMISSIONED'); assert.equal(result.exit_code, 0);
        assert.equal(result.healthy, null); assert.equal(result.network_attempted, false); assert.equal(result.production_authorized, false);
    }
});
test('uncommissioned state cannot ignore unexpected deployment configuration', async () => {
    assert.equal((await runMonitor({ policy: uncommissioned, env: environment(), request: noNetwork })).status, 'CONFIGURATION_ERROR');
});
test('lost or malformed commissioning policy fails instead of resetting state', async () => {
    for (const policy of [undefined, {}, { ...uncommissioned, state: '' }, { ...commissioned, provider: 'OTHER' }, { ...commissioned, extra: true }]) {
        const result = await runMonitor({ policy, env: {}, request: noNetwork }); assert.equal(result.exit_code, 1); assert.equal(result.status, 'CONFIGURATION_ERROR');
    }
});
for (const key of ['NONCLINICAL_MONITOR_DOMAIN', 'NONCLINICAL_MONITOR_MANIFEST', 'NONCLINICAL_MONITOR_MANIFEST_SHA256']) {
    test('commissioned monitor fails when configuration disappears: ' + key, async () => {
        const env = environment(); delete env[key];
        const result = await runMonitor({ policy: commissioned, env, request: noNetwork });
        assert.equal(result.status, 'CONFIGURATION_ERROR'); assert.equal(result.exit_code, 1); assert.equal(result.healthy, null);
    });
}
test('clearing every environment variable after commissioning remains a failure', async () => {
    const result = await runMonitor({ policy: commissioned, env: {}, request: noNetwork }); assert.equal(result.exit_code, 1); assert.equal(result.status, 'CONFIGURATION_ERROR');
});
test('manifest parse, integrity, shape and member bounds are checked before probing', async () => {
    const cases = ['{', 'null', '', 'x'.repeat(65537), { ...manifest, production_authorized: true }, { ...manifest, members: [...manifest.members, manifest.members[0]] },
        { ...manifest, artifact_sha256: sha256('wrong') }, { ...manifest, extra: true }];
    for (const bytes of [-1, 0, 1024 * 1024 + 1, 0.5]) {
        const changed = structuredClone(core); changed.members[0].bytes = bytes;
        cases.push({ ...manifest, ...changed, artifact_sha256: sha256(canonical(changed)) });
    }
    for (const value of cases) assert.equal((await runMonitor({ policy: commissioned, env: environment(value), request: noNetwork })).status, 'CONFIGURATION_ERROR');
    const env = environment(); env.NONCLINICAL_MONITOR_MANIFEST += '\n';
    assert.equal((await runMonitor({ policy: commissioned, env, request: noNetwork })).status, 'CONFIGURATION_ERROR');
});
test('foreign host, arbitrary URL and changed commissioned domain never receive requests', async () => {
    for (const domain of ['localhost', '169.254.169.254', 'clinical.vetios.tech', 'https://vetios-public-static.vercel.app', 'vetios-public-static.vercel.app.evil.test']) {
        assert.equal((await runMonitor({ policy: commissioned, env: environment(manifest, domain), request: noNetwork })).status, 'CONFIGURATION_ERROR');
        assert.equal((await runMonitor({ policy: { ...commissioned, domain }, env: environment(manifest, domain), request: noNetwork })).status, 'CONFIGURATION_ERROR');
    }
});
for (const policy of [commissioned, { ...commissioned, provider: 'AWS_CLOUDFRONT', domain: 'd12345678.cloudfront.net' }]) {
    test('all aliases, GET/HEAD and forbidden endpoints are observed for ' + policy.provider, async () => {
        const calls = [], result = await runMonitor({ policy, env: environment(manifest, policy.domain), request: healthyRequest(policy, calls) });
        assert.equal(result.status, 'OBSERVED_HEALTHY'); assert.equal(result.exit_code, 0); assert.equal(result.healthy, true);
        assert.equal(result.production_authorized, false); assert.equal(calls.length, Object.keys(ROUTES).length * 2 + 5);
    });
}
for (const kind of ['wrong-body', 'oversized-body', 'missing-header', 'cookie', 'protected', 'redirect', 'network-error', 'exposed-api', 'accepted-post']) {
    test('public health is not established on ' + kind, async () => {
        const request = async (url, options) => {
            const uri = new URL(url).pathname;
            if (kind === 'network-error') throw Error('private provider response must not be logged');
            if (kind === 'exposed-api' && uri === '/api/inference') return new Response(null, { status: 200 });
            if (kind === 'accepted-post' && uri === '/' && options.method === 'POST') return new Response(null, { status: 200 });
            if (uri === '/' && options.method === 'GET') {
                if (kind === 'protected') return new Response('login', { status: 401 });
                if (kind === 'redirect') return new Response(null, { status: 302 });
                const headers = { ...HEADERS };
                if (kind === 'missing-header') delete headers['content-security-policy'];
                if (kind === 'cookie') headers['set-cookie'] = 'session=fixture';
                const expected = bodies.get('index.html');
                return new Response(kind === 'wrong-body' ? Buffer.alloc(expected.length) : kind === 'oversized-body' ? Buffer.alloc(expected.length + 1) : expected, { headers });
            }
            return healthyRequest(commissioned)(url, options);
        };
        const result = await runMonitor({ policy: commissioned, env: environment(), request });
        assert.equal(result.status, 'PROBE_FAILED'); assert.equal(result.exit_code, 1); assert.equal(result.healthy, null);
        assert.doesNotMatch(canonical(result), /private provider/);
    });
}
test('checked-in monitor policy stays explicitly uncommissioned until actual operational authorization', async () => {
    assert.deepEqual(JSON.parse(await fs.readFile(new URL('./monitor-policy.json', import.meta.url), 'utf8')), uncommissioned);
});

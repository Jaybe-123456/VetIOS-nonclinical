import path from 'node:path';
import assert from 'node:assert/strict';
import { TARGET } from './vercel-release-policy.mjs';
import { deploymentIdentity } from './vercel-release.mjs';
import { probePublicArtifact } from './monitor.mjs';
import { canonical } from './policy.mjs';
import { sha256 } from './build.mjs';
import { regular } from './deploy.mjs';
import { inspectVercelOutput } from './vercel.mjs';

export async function boundedResponse(response, limit = 1024 * 1024) {
    const chunks = []; let length = 0;
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break;
            length += value.length; assert.ok(length <= limit, 'provider response too large'); chunks.push(value);
        }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
}

export function vercelProvider({ directory, env = process.env, request = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const settle = async check => {
        for (let attempt = 0; attempt < 10; attempt++) {
            try { return await check(); } catch { if (attempt === 9) throw Error('provider state not observed within reconciliation window'); }
            await delay(2000); // Read-only convergence polling; mutations are never retried here.
        }
    };
    const api = async (route, method = 'GET', body, prebuilt = false) => {
        assert.ok(env.VERCEL_TOKEN, 'protected Vercel credential required');
        assert.match(route, /^\/v\d+\/(?:projects|deployments)(?:\/[A-Za-z0-9._/-]+)?$/);
        const response = await request('https://api.vercel.com' + route + '?teamId=' + TARGET.team + (prebuilt ? '&prebuilt=1' : ''),
            { method, headers: { authorization: 'Bearer ' + env.VERCEL_TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
                ...(body ? { body: canonical(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
        const bytes = await boundedResponse(response);
        assert.ok(response.ok, 'Vercel request failed; response withheld');
        return bytes.length ? JSON.parse(bytes) : null;
    };
    return {
        project: async () => {
            const [project, domains] = await Promise.all([api('/v9/projects/' + TARGET.project), api('/v9/projects/' + TARGET.project + '/domains')]);
            // Omitted env inventory must not silently establish that no credentials exist.
            assert.ok(Array.isArray(project.env), 'complete project environment metadata required');
            return { project, domains };
        },
        deployment: async id => {
            assert.match(id, /^dpl_[A-Za-z0-9]{8,80}$/);
            const [deployment, aliases] = await Promise.all([api('/v13/deployments/' + id), api('/v2/deployments/' + id + '/aliases')]);
            assert.ok(Array.isArray(aliases.aliases)); assert.ok(!aliases.pagination?.next, 'alias inventory truncated');
            return { ...deployment, assignedAliases: aliases.aliases.map(a => a.alias) };
        },
        stage: async candidate => {
            const qualified = path.join(directory, 'qualified'), outputRoot = path.join(qualified, 'vercel/.vercel/output');
            const output = await inspectVercelOutput({ outputRoot, artifactDirectory: path.join(qualified, 'candidate'), verificationDirectory: qualified });
            assert.equal(output.artifact_sha256, candidate.artifact_sha256);
            assert.equal(output.source_sha256, candidate.source_sha256);
            assert.equal(output.vercel_output_sha256, candidate.vercel_output_sha256);
            const files = [];
            for (const member of output.members) {
                const bytes = await regular(path.join(outputRoot, member.path));
                assert.equal(bytes.length, member.bytes); assert.equal(sha256(bytes), member.sha256);
                files.push({ file: '.vercel/output/' + member.path, data: bytes.toString('base64'), encoding: 'base64', mode: 0o100644 });
            }
            assert.equal(files.length, 8);
            // Same prebuilt query and domain-assignment flag as the official client. No source, build or env upload.
            const body = { version: 2, name: TARGET.name, project: TARGET.project, target: 'production', autoAssignCustomDomains: false,
                files, meta: { vetiosArtifact: candidate.artifact_sha256, vetiosSource: candidate.source_sha256, vetiosOutput: candidate.vercel_output_sha256 } };
            assert.ok(Buffer.byteLength(canonical(body)) <= 1024 * 1024, 'bounded static upload required');
            const created = await api('/v13/deployments', 'POST', body, true);
            deploymentIdentity(created); assert.equal(created.projectId, TARGET.project);
            // A create timeout is never retried. Only read-only readiness polling follows a returned identity.
            await settle(async () => { assert.equal((await api('/v13/deployments/' + created.id)).readyState, 'READY'); });
            return created.id;
        },
        probe: async (deployment, artifact, protectedStage) => {
            deploymentIdentity(deployment);
            if (!protectedStage) return probePublicArtifact({ provider: 'VERCEL', domain: TARGET.domain }, artifact, request);
            // Establish anonymous denial independently; do not mistake successful authenticated probes for public health.
            const origin = 'https://' + deployment.url;
            const anonymous = await request(origin + '/', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
            try {
                const location = anonymous.headers.get('location');
                const sso = location && new URL(location, origin);
                assert.ok([401, 403].includes(anonymous.status) || ([302, 307].includes(anonymous.status) && sso?.origin === 'https://vercel.com'), 'staged deployment must deny anonymous access');
            } finally { if (anonymous.body) await anonymous.body.cancel(); }
            assert.ok(env.VERCEL_AUTOMATION_BYPASS_SECRET, 'project-scoped CI probe access must be commissioned');
            const authenticated = (url, options) => {
                assert.equal(new URL(url).origin, origin); assert.equal(options.redirect, 'error');
                return request(url, { ...options, headers: { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } });
            };
            await probePublicArtifact({ provider: 'VERCEL', domain: deployment.url }, artifact, authenticated);
            return { status: 'PROTECTED_ARTIFACT_VERIFIED', public_health_established: false };
        },
        promote: id => { deploymentIdentity({ id, url: 'vetios-public-static-id.vercel.app' }); return api('/v10/projects/' + TARGET.project + '/promote/' + id, 'POST'); },
        rollback: id => { deploymentIdentity({ id, url: 'vetios-public-static-id.vercel.app' }); return api('/v1/projects/' + TARGET.project + '/rollback/' + id, 'POST'); },
        pause: () => api('/v1/projects/' + TARGET.project + '/pause', 'POST'),
        publicAlias: id => settle(async () => {
            const current = await api('/v13/deployments/' + TARGET.domain);
            assert.equal(current.id, id); assert.equal(current.projectId, TARGET.project); assert.equal(current.target, 'production');
        }),
        suspended: (deployment, staged) => settle(async () => {
            const project = await api('/v9/projects/' + TARGET.project); assert.equal(project.paused, true);
            deploymentIdentity(deployment);
            if (staged) assert.ok(env.VERCEL_AUTOMATION_BYPASS_SECRET);
            const response = await request('https://' + (staged ? deployment.url : TARGET.domain) + '/', { redirect: 'error', signal: AbortSignal.timeout(10000),
                ...(staged ? { headers: { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } } : {}) });
            const body = await boundedResponse(response, 65536);
            assert.equal(response.status, 503); assert.ok(body.toString().includes('DEPLOYMENT_PAUSED'), 'actual provider suspension must be observed');
        }),
    };
}

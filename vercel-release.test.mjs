import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from './build.mjs';
import { canonical, GOVERNANCE, HEADERS, ROUTES } from './policy.mjs';
import { privateBytes, inspectCommissioning, approvedCommissioning } from './commissioning-intake.mjs';
import { TARGET, BASE, sourceAuthorization, releaseInputs, trustedPriorRun, pages, repositoryMonitorVariables } from './vercel-release-policy.mjs';
import { deliver, inspectPrior, inspectDeployment, inspectProject, publicMonitorReady } from './vercel-release.mjs';
import { vercelProvider, boundedResponse } from './vercel-provider.mjs';

// Every provider/owner record below is a synthetic mechanics fixture. No operational claim is made.
const H = sha256('synthetic evidence'), C = 'a'.repeat(40), NOW = Date.parse('2026-10-29T12:00:00Z');
function packet() {
    return { schema: 'vetios-nonclinical-commissioning-v1', scope: 'VERCEL_STATIC_ONLY', operator: 'John Bruce', contact: 'platform@vetios.tech',
        provider: 'Synthetic test provider', response_hours: 'Synthetic working hours', retention_policy: 'Synthetic 30 days',
        recorded_at: '2026-10-29T11:00:00Z', expires_at: '2026-11-01T11:00:00Z',
        mail: { inbound_sent_at: '2026-10-29T09:00:00Z', inbound_delivered_at: '2026-10-29T09:01:00Z', reply_sent_at: '2026-10-29T09:02:00Z',
            reply_delivered_at: '2026-10-29T09:03:00Z', operator_acknowledged_at: '2026-10-29T09:04:00Z', message_ids_sha256: H, provider_record_sha256: H },
        alert: { triggered_by: 'Synthetic independent tester', triggered_at: '2026-10-29T10:00:00Z', delivered_at: '2026-10-29T10:01:00Z',
            acknowledged_by: 'John Bruce', acknowledged_at: '2026-10-29T10:02:00Z', event_id_sha256: H, provider_record_sha256: H },
        reviews: { operator_acceptance: H, identity_and_privacy: H, provider_access_and_retention: H, security: H, suspension_drill: H } };
}
test('commissioning intake verifies shape and integrity while keeping records unapproved', () => {
    const raw = canonical(packet()), receipt = inspectCommissioning(raw, { now: NOW });
    assert.equal(receipt.status, 'IMPORTED_UNAPPROVED'); assert.equal(receipt.operational_truth_verified, false);
    assert.equal(approvedCommissioning(raw, sha256(raw), { now: NOW }).production_authorized, false);
    assert.throws(() => approvedCommissioning(raw, H, { now: NOW }));
});
for (const [name, mutate] of [
    ['raw message body', p => { p.mail.body = 'private'; }], ['secret field', p => { p.token = 'private'; }],
    ['missing provider proof', p => { delete p.mail.provider_record_sha256; }], ['no independent alert', p => { p.alert.triggered_by = 'John Bruce'; }],
    ['future event', p => { p.alert.acknowledged_at = '2026-10-30T00:00:00Z'; }], ['expired', p => { p.expires_at = '2026-10-29T11:01:00Z'; }],
    ['wrong operator', p => { p.operator = 'Unappointed'; }], ['reply before receipt', p => { p.mail.reply_delivered_at = p.mail.inbound_sent_at; }],
    ['invented approval field', p => { p.status = 'APPROVED'; }], ['clinical scope', p => { p.scope = 'CLINICAL'; }],
]) test('commissioning rejects ' + name, () => { const p = packet(); mutate(p); assert.throws(() => inspectCommissioning(canonical(p), { now: NOW })); });

test('private evidence rejects public permissions, links, oversized files and non-files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vetios-intake-'));
    try {
        const file = path.join(dir, 'packet'); await fs.writeFile(file, canonical(packet()), { mode: 0o600 });
        assert.equal((await privateBytes(file)).toString(), canonical(packet()));
        await fs.chmod(file, 0o644); await assert.rejects(() => privateBytes(file)); await fs.chmod(file, 0o600);
        await fs.symlink(file, path.join(dir, 'link')); await assert.rejects(() => privateBytes(path.join(dir, 'link')));
        await fs.symlink(dir, path.join(dir, 'parent')); await assert.rejects(() => privateBytes(path.join(dir, 'parent/packet')));
        await fs.writeFile(file, 'x'.repeat(48 * 1024 + 1)); await assert.rejects(() => privateBytes(file));
        await assert.rejects(() => privateBytes(dir));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

function githubFixture() {
    const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: TARGET.repository, GITHUB_REPOSITORY_ID: String(TARGET.repository_id),
        GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: C, GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1' };
    const identity = { id: TARGET.repository_id }, owner = { id: 1, type: 'User' }, reviewer = { id: 2, type: 'User' };
    const records = new Map([
        [BASE, { ...identity, default_branch: 'main', fork: false }], [BASE + '/branches/main', { commit: { sha: C } }],
        [BASE + '/branches/main/protection', { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
            required_status_checks: { strict: true, checks: [{ context: 'qualify', app_id: 15368 }] },
            required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_last_push_approval: true } }],
        [BASE + '/environments/' + TARGET.environment, { protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer }] }],
            can_admins_bypass: false, deployment_branch_policy: { custom_branch_policies: true } }],
        [BASE + '/environments/' + TARGET.environment + '/deployment-branch-policies', { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] }],
        [BASE + '/actions/runs/1234', { repository: identity, head_repository: identity, event: 'workflow_dispatch', path: TARGET.workflow, head_sha: C,
            head_branch: 'main', run_attempt: 1, actor: owner, triggering_actor: owner, conclusion: 'success' }],
        [BASE + '/commits/' + C + '/pulls?per_page=100&page=1', [{ number: 6, merged_at: '2026-10-29T00:00:00Z', merge_commit_sha: C,
            base: { ref: 'main', repo: identity }, head: { repo: identity, sha: C }, user: owner }]],
        [BASE + '/pulls/6/reviews?per_page=100&page=1', [{ id: 1, state: 'APPROVED', commit_id: C, user: reviewer }]],
        [BASE + '/commits/' + C + '/check-runs?per_page=100', { total_count: 1, check_runs: [{ id: 1, name: 'qualify', app: { id: 15368 }, conclusion: 'success' }] }],
        [BASE + '/actions/runs/1234/approvals', [{ state: 'approved', user: reviewer, environments: [{ name: TARGET.environment }] }]],
    ]);
    return { env, records, get: async route => { assert.ok(records.has(route), route); return structuredClone(records.get(route)); } };
}
test('source approval requires actual independent PR and environment reviews of a trusted main run', async () => {
    const f = githubFixture(); const result = await sourceAuthorization(f.env, f.get, true); assert.equal(result.approver_id, 2);
    await trustedPriorRun('1234', { authorization: result }, f.get);
});
for (const [name, mutate] of [
    ['missing PR review protection', f => { f.records.get(BASE + '/branches/main/protection').required_pull_request_reviews = null; }],
    ['absent submitted review', f => { f.records.set(BASE + '/pulls/6/reviews?per_page=100&page=1', []); }],
    ['COMMENTED bot', f => { f.records.get(BASE + '/pulls/6/reviews?per_page=100&page=1')[0].state = 'COMMENTED'; }],
    ['stale approval', f => { f.records.get(BASE + '/pulls/6/reviews?per_page=100&page=1')[0].commit_id = 'b'.repeat(40); }],
    ['author self approval', f => { f.records.get(BASE + '/pulls/6/reviews?per_page=100&page=1')[0].user.id = 1; }],
    ['later changes requested', f => { f.records.get(BASE + '/pulls/6/reviews?per_page=100&page=1').push({ id: 2, user: { id: 2 }, state: 'CHANGES_REQUESTED' }); }],
    ['main changed', f => { f.records.get(BASE + '/branches/main').commit.sha = 'b'.repeat(40); }],
    ['workflow retry', f => { f.env.GITHUB_RUN_ATTEMPT = '2'; }], ['fork', f => { f.records.get(BASE).fork = true; }],
    ['clinical repo', f => { f.env.GITHUB_REPOSITORY = 'Karshadev/VetIOS'; }], ['self hosted runner', f => { f.env.RUNNER_ENVIRONMENT = 'self-hosted'; }],
    ['failed qualification', f => { f.records.get(BASE + '/commits/' + C + '/check-runs?per_page=100').check_runs[0].conclusion = 'failure'; }],
    ['admin bypass', f => { f.records.get(BASE + '/environments/' + TARGET.environment).can_admins_bypass = true; }],
    ['wildcard deploy branch', f => { f.records.get(BASE + '/environments/' + TARGET.environment + '/deployment-branch-policies').branch_policies[0].name = '*'; }],
    ['environment self approval', f => { f.records.get(BASE + '/actions/runs/1234/approvals')[0].user.id = 1; }],
]) test('source trust blocks ' + name, async () => { const f = githubFixture(); mutate(f); await assert.rejects(() => sourceAuthorization(f.env, f.get, true)); });
test('review pagination cannot silently truncate', async () => {
    let calls = 0; await assert.rejects(() => pages(async () => { calls++; return Array(100).fill({}); }, '/fixture'), /pagination/); assert.equal(calls, 20);
});

const bodies = new Map([...new Set(Object.values(ROUTES))].map(file => [file, Buffer.from('synthetic provider bytes: ' + file)]));
const core = { schema: 'vetios-nonclinical-artifact-v1', source_sha256: H, members: [...bodies].map(([name, body]) => ({ path: name, bytes: body.length, sha256: sha256(body) })) };
const artifact = { ...core, artifact_sha256: sha256(canonical(core)), governance: GOVERNANCE, production_authorized: false };
const candidate = { source_sha256: H, artifact_sha256: artifact.artifact_sha256, vercel_output_sha256: H, verification_sha256: H, security_sha256: H, artifact };
const deployment = { id: 'dpl_synthetic123', url: 'vetios-public-static-synthetic.vercel.app' };
const project = () => ({ project: { id: TARGET.project, accountId: TARGET.team, name: TARGET.name, framework: null, link: null, env: [],
    ssoProtection: { deploymentType: 'all_except_custom_domains' }, paused: false }, domains: { domains: [{ name: TARGET.domain, verified: true }] } });
const observed = (staged = true) => ({ ...deployment, projectId: TARGET.project, target: 'production', readyState: 'READY', assignedAliases: staged ? [] : [TARGET.domain],
    meta: { vetiosArtifact: candidate.artifact_sha256, vetiosSource: H, vetiosOutput: H } });
function deliveryFixture(mode = 'stage') {
    const calls = [], records = new Map(), authorization = { source_commit: C, run_id: '1234', attempt: 1, approver_id: 2 };
    let staged = mode === 'stage' || mode === 'promote';
    const prior = { schema: 'vetios-vercel-release-v1', target: TARGET, authorization, candidate, deployment, clinical_release_authorized: false,
        commissioning_packet_sha256: mode === 'rollback' ? H : null,
        status: mode === 'rollback' ? 'PUBLISHED_VERIFIED' : 'STAGED_VERIFIED' };
    const input = { mode, artifact_sha256: candidate.artifact_sha256, prior_run: mode === 'stage' ? '' : '1234',
        receipt_sha256: mode === 'stage' ? '' : sha256(canonical(prior)), public_access: ['promote', 'rollback'].includes(mode) ? TARGET.domain : '' };
    return { calls, records, input, prior: mode === 'stage' ? undefined : prior, candidate, authorize: async () => { calls.push('authorize'); return authorization; },
        commissioning: async () => { calls.push('commissioning'); return inspectCommissioning(canonical(packet()), { now: NOW }); }, monitorReady: async () => { calls.push('monitor'); },
        audit: async (name, value) => { assert.ok(!records.has(name)); records.set(name, value); calls.push(name); },
        provider: { project: async () => project(), deployment: async () => observed(staged), stage: async () => { calls.push('stage'); return deployment.id; },
            probe: async (_, a, protectedProbe) => { assert.equal(a.artifact_sha256, candidate.artifact_sha256); calls.push(protectedProbe ? 'protected-probe' : 'public-probe'); },
            promote: async () => { calls.push('promote'); staged = false; }, rollback: async () => { calls.push('rollback'); staged = false; },
            pause: async () => { calls.push('pause'); }, suspended: async () => { calls.push('suspended'); }, publicAlias: async () => { calls.push('alias'); } } };
}
test('stage writes intent, deploys production without aliases, verifies and never promotes', async () => {
    const f = deliveryFixture(); const result = await deliver(f); assert.equal(result.status, 'STAGED_VERIFIED');
    assert.deepEqual(f.calls, ['authorize', 'intent.json', 'stage', 'protected-probe', 'outcome.json']);
    assert.equal(result.clinical_release_authorized, false);
});
test('promotion reuses exactly the staged deployment and bytes with a new approval', async () => {
    const f = deliveryFixture('promote'); assert.equal((await deliver(f)).status, 'PUBLISHED_VERIFIED');
    assert.ok(f.calls.includes('monitor')); assert.ok(!f.calls.includes('stage'));
    assert.ok(f.calls.indexOf('protected-probe') < f.calls.indexOf('promote')); assert.ok(f.calls.includes('public-probe'));
});
test('suspension is available even when commissioning is expired and never unpauses', async () => {
    const f = deliveryFixture('suspend'); f.commissioning = () => assert.fail('suspension must not need expired commissioning');
    assert.equal((await deliver(f)).status, 'SUSPENDED_VERIFIED'); assert.ok(f.calls.includes('suspended')); assert.ok(!f.calls.includes('stage'));
});
test('rollback requires a previously published receipt and reuses its deployment', async () => {
    const f = deliveryFixture('rollback'); const prior = inspectPrior(canonical(f.prior), f.input.receipt_sha256, 'rollback', candidate.artifact_sha256);
    assert.equal(prior.status, 'PUBLISHED_VERIFIED'); assert.equal((await deliver(f)).status, 'PUBLISHED_VERIFIED'); assert.ok(!f.calls.includes('stage'));
    prior.status = 'STAGED_VERIFIED'; assert.throws(() => inspectPrior(canonical(prior), sha256(canonical(prior)), 'rollback', candidate.artifact_sha256));
});
for (const failure of ['authorize', 'intent', 'stage', 'probe', 'outcome']) {
    test('release fails closed at ' + failure + ' without retries or false success', async () => {
        const f = deliveryFixture();
        if (failure === 'authorize' || failure === 'commissioning') f[failure] = async () => { throw Error('fixture failure'); };
        if (failure === 'stage' || failure === 'probe') f.provider[failure] = async () => { f.calls.push(failure); throw Error('fixture failure'); };
        if (failure === 'intent' || failure === 'outcome') { const audit = f.audit; f.audit = async (name, value) => { if (name === failure + '.json') throw Error('audit unavailable'); await audit(name, value); }; }
        await assert.rejects(() => deliver(f)); assert.ok(f.calls.filter(c => c === 'stage').length <= 1);
        assert.equal(f.records.has('outcome.json'), false); assert.equal(f.calls.includes('promote'), false);
        assert.equal(f.records.has('uncertain.json'), ['stage', 'probe', 'outcome'].includes(failure));
    });
}
test('missing operational records block publication before provider mutation', async () => {
    const f = deliveryFixture('promote'); f.commissioning = () => { throw Error('real records missing'); };
    await assert.rejects(() => deliver(f)); assert.equal(f.calls.includes('promote'), false);
});
test('publication journals bind the checked private packet without publishing its content or granting intake authority', async () => {
    for (const mode of ['promote', 'rollback']) {
        const f = deliveryFixture(mode); const result = await deliver(f);
        const expected = sha256(canonical(packet()));
        assert.equal(result.commissioning_packet_sha256, expected);
        assert.equal(f.records.get('intent.json').commissioning_packet_sha256, expected);
        assert.equal(f.records.get('outcome.json').commissioning_packet_sha256, expected);
        assert.equal(JSON.stringify(result).includes('platform@vetios.tech'), false);
        const missing = { ...result }; delete missing.commissioning_packet_sha256;
        assert.throws(() => inspectPrior(canonical(missing), sha256(canonical(missing)), 'rollback', candidate.artifact_sha256));
    }
});
test('a missing or self-authorizing intake result fails before any provider mutation', async () => {
    for (const intake of [undefined, {}, { ...inspectCommissioning(canonical(packet()), { now: NOW }), production_authorized: true }]) {
        const f = deliveryFixture('promote'); f.commissioning = async () => intake;
        await assert.rejects(() => deliver(f));
        assert.equal(f.calls.includes('promote'), false); assert.equal(f.records.size, 0);
    }
});
test('promotion rejects stale source and absent public-access decision before provider mutation', async () => {
    const f = deliveryFixture('promote'); f.prior.authorization = { ...f.prior.authorization, source_commit: 'b'.repeat(40) };
    await assert.rejects(() => deliver(f), /stale/); assert.equal(f.calls.includes('promote'), false);
    f.input.public_access = ''; assert.throws(() => releaseInputs(f.input));
});
test('foreign project, disabled SSO and unexpected runtime credentials block publication', () => {
    for (const mutate of [p => { p.project.accountId = 'foreign'; }, p => { p.project.ssoProtection = null; },
        p => { p.project.ssoProtection.enabled = false; }, p => { p.project.env = [{}]; },
        p => { p.domains.domains.push({ name: 'clinical.vetios.tech', verified: true }); },
        p => { p.domains.domains = []; }]) {
        const p = project(); mutate(p); assert.throws(() => inspectProject(p.project, p.domains, 'promote'));
    }
});
test('explicitly disabled optional Vercel protections are accepted while active or ambiguous ones fail closed', () => {
    const p = project();
    p.project.passwordProtection = { enabled: false, deploymentType: null };
    p.project.trustedIps = { enabled: false, deploymentType: null, addresses: [] };
    assert.doesNotThrow(() => inspectProject(p.project, p.domains, 'stage'));
    p.project.passwordProtection = { enabled: true, deploymentType: 'all' };
    assert.throws(() => inspectProject(p.project, p.domains, 'stage'));
    p.project.passwordProtection = { enabled: false, deploymentType: 'all' };
    assert.throws(() => inspectProject(p.project, p.domains, 'stage'));
    p.project.passwordProtection = 'disabled';
    assert.throws(() => inspectProject(p.project, p.domains, 'stage'));
});
test('preview deployments, changed metadata and premature alias assignment cannot be promoted as tested bytes', () => {
    for (const mutate of [d => { d.target = 'preview'; }, d => { d.meta.vetiosOutput = sha256('changed'); }, d => { d.assignedAliases = [TARGET.domain]; }, d => { d.url += '.evil.test'; }]) {
        const d = observed(); mutate(d); assert.throws(() => inspectDeployment(d, candidate, { staged: true }));
    }
});
test('commissioned monitoring requires exact public artifact and raw manifest digest', () => {
    const policy = { schema: 'vetios-nonclinical-monitor-policy-v1', state: 'COMMISSIONED', provider: 'VERCEL', domain: TARGET.domain };
    const env = { NONCLINICAL_MONITOR_DOMAIN: TARGET.domain, NONCLINICAL_MONITOR_MANIFEST: canonical(artifact), NONCLINICAL_MONITOR_MANIFEST_SHA256: sha256(canonical(artifact)) };
    publicMonitorReady(policy, env, artifact); assert.throws(() => publicMonitorReady({ ...policy, state: 'NOT_COMMISSIONED' }, env, artifact));
    env.NONCLINICAL_MONITOR_MANIFEST += '\n'; assert.throws(() => publicMonitorReady(policy, env, artifact));
});

test('provider sends probe credentials only to the verified staged origin and never follows redirects', async () => {
    const calls = [];
    const request = async (url, options) => {
        calls.push({ url, options }); const u = new URL(url), file = ROUTES[u.pathname];
        assert.equal(u.hostname, deployment.url);
        if (!options.headers) return new Response(null, { status: 401 });
        assert.equal(options.redirect, 'error'); assert.deepEqual(options.headers, { 'x-vercel-protection-bypass': 'synthetic-test-only' });
        return new Response(options.method === 'HEAD' || options.method === 'POST' ? null : bodies.get(file),
            { status: !file ? 404 : options.method === 'POST' ? 405 : 200, headers: HEADERS });
    };
    const provider = vercelProvider({ directory: '/unused', env: { VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-test-only' }, request });
    assert.equal((await provider.probe(deployment, artifact, true)).public_health_established, false);
    assert.equal(calls.length, Object.keys(ROUTES).length * 2 + 6);
    await assert.rejects(() => provider.probe({ ...deployment, url: 'attacker.test' }, artifact, true));
});
test('a publicly exposed staging URL is rejected before a probe secret is sent', async () => {
    let calls = 0;
    const provider = vercelProvider({ directory: '/unused', env: {}, request: async (_, options) => { calls++; assert.equal(options.headers, undefined); return new Response('exposed'); } });
    await assert.rejects(() => provider.probe(deployment, artifact, true)); assert.equal(calls, 1);
});
test('provider response bounds reject oversized bodies', async () => {
    await assert.rejects(() => boundedResponse(new Response('12345'), 4));
});

test('environment monitor overrides cannot differ from the actual scheduled repository variables', async () => {
    const env = { NONCLINICAL_MONITOR_DOMAIN: TARGET.domain, NONCLINICAL_MONITOR_MANIFEST: canonical(artifact), NONCLINICAL_MONITOR_MANIFEST_SHA256: sha256(canonical(artifact)) };
    const get = async route => { const name = route.split('/').at(-1); return { name, value: env[name] }; };
    assert.deepEqual(await repositoryMonitorVariables(env, get), env);
    await assert.rejects(() => repositoryMonitorVariables({ ...env, NONCLINICAL_MONITOR_DOMAIN: 'shadow.example' }, get));
});
test('alias inventory, not alias processing timestamp, establishes unpromoted state', async () => {
    const provider = vercelProvider({ directory: '/unused', env: { VERCEL_TOKEN: 'synthetic-test-only' }, request: async url => {
        if (new URL(url).pathname.endsWith('/aliases')) return Response.json({ aliases: [] });
        return Response.json({ ...observed(), aliasAssigned: 1793260800000 });
    } });
    inspectDeployment(await provider.deployment(deployment.id), candidate, { staged: true });
});
test('suspension checks the protected production candidate when no public alias exists yet', async () => {
    const requests = [];
    const provider = vercelProvider({ directory: '/unused', env: { VERCEL_TOKEN: 'synthetic-test-only', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-probe-only' }, request: async (url, options) => {
        requests.push([url, options]);
        if (new URL(url).hostname === 'api.vercel.com') return Response.json({ paused: true });
        assert.equal(new URL(url).hostname, deployment.url); assert.equal(options.headers['x-vercel-protection-bypass'], 'synthetic-probe-only');
        return new Response('DEPLOYMENT_PAUSED', { status: 503 });
    } });
    await provider.suspended(deployment, true); assert.equal(requests.length, 2);
});
test('provider mutation errors are not retried and cannot emit credential-bearing responses', async () => {
    let calls = 0;
    const provider = vercelProvider({ directory: '/unused', env: { VERCEL_TOKEN: 'synthetic-test-only' }, request: async () => {
        calls++; return new Response('private provider diagnostic', { status: 500 });
    } });
    await assert.rejects(() => provider.promote(deployment.id), error => !error.message.includes('private provider diagnostic'));
    assert.equal(calls, 1);
});

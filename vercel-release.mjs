import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ROOT, sha256 } from './build.mjs';
import { canonical, shaPattern } from './policy.mjs';
import { regular } from './deploy.mjs';
import { inspectVercelOutput } from './vercel.mjs';
import { validateMonitorManifest, validateMonitorPolicy } from './monitor.mjs';
import { approvedCommissioning } from './commissioning-intake.mjs';
import { TARGET, releaseInputs, sourceAuthorization, trustedPriorRun, repositoryMonitorVariables } from './vercel-release-policy.mjs';

export async function qualifiedArtifact(directory, expected) {
    assert.match(expected, shaPattern);
    const qualified = path.join(directory, 'qualified');
    const output = await inspectVercelOutput({ outputRoot: path.join(qualified, 'vercel/.vercel/output'),
        artifactDirectory: path.join(qualified, 'candidate'), verificationDirectory: qualified });
    assert.equal(output.artifact_sha256, expected, 'dispatch must select the exact qualified artifact');
    const securityBytes = await regular(path.join(directory, 'security/security.json')), security = JSON.parse(securityBytes);
    assert.equal(security.status, 'PASS'); assert.equal(security.profile, 'VERCEL_STATIC');
    assert.equal(security.source_sha256, output.source_sha256); assert.equal(security.artifact_sha256, expected);
    assert.equal(security.vercel_output_sha256, output.vercel_output_sha256); assert.equal(security.runtime_dependencies, 0);
    assert.equal(security.deployment_authorized, false); assert.equal(security.clinical_history_findings_closed, false);
    const expectedLogs = { scanner_suppression_denied: ['scanner-adverse.log', 2], gitleaks_source: ['gitleaks-source.log', 0],
        gitleaks_public: ['gitleaks-public.log', 0], gitleaks_vercel: ['gitleaks-vercel.log', 0], audit: ['npm-audit.log', 0] };
    assert.deepEqual(Object.keys(security.checks).sort(), Object.keys(expectedLogs).sort());
    for (const [name, [file, code]] of Object.entries(expectedLogs)) {
        const check = security.checks[name]; assert.equal(check.log, file); assert.equal(check.exit_code, code);
        assert.equal(sha256(await regular(path.join(directory, 'security', file))), check.sha256, 'security evidence changed');
    }
    assert.equal(JSON.parse(await regular(path.join(directory, 'security/npm-audit.log'))).metadata.vulnerabilities.total, 0);
    for (const name of ['source', 'public', 'vercel']) assert.deepEqual(JSON.parse(await regular(path.join(directory, 'security/gitleaks-' + name + '.json'))), []);
    const artifact = JSON.parse(await regular(path.join(qualified, 'candidate/artifact.json')));
    return { source_sha256: output.source_sha256, artifact_sha256: expected, vercel_output_sha256: output.vercel_output_sha256,
        verification_sha256: sha256(await regular(path.join(qualified, 'nonclinical-verification.json'))), security_sha256: sha256(securityBytes), artifact };
}

export function inspectPrior(raw, expectedDigest, mode, expectedArtifact) {
    assert.match(expectedDigest, shaPattern); assert.equal(sha256(raw), expectedDigest, 'prior receipt bytes changed');
    const receipt = JSON.parse(raw);
    assert.equal(receipt.schema, 'vetios-vercel-release-v1'); assert.deepEqual(receipt.target, TARGET);
    assert.equal(receipt.clinical_release_authorized, false);
    assert.ok(receipt.authorization.approver_id, 'prior human approval absent');
    assert.ok(['STAGED_VERIFIED', 'PUBLISHED_VERIFIED'].includes(receipt.status), 'unknown, failed or suspended outcome is not a recovery baseline');
    if (receipt.status === 'PUBLISHED_VERIFIED') assert.match(receipt.commissioning_packet_sha256, shaPattern, 'published receipt must identify the checked operational packet');
    else assert.equal(receipt.commissioning_packet_sha256, null);
    if (mode === 'promote') assert.equal(receipt.status, 'STAGED_VERIFIED');
    if (mode === 'rollback') assert.equal(receipt.status, 'PUBLISHED_VERIFIED', 'rollback requires a real earlier healthy publication');
    for (const key of ['source_sha256', 'artifact_sha256', 'vercel_output_sha256', 'verification_sha256', 'security_sha256']) assert.match(receipt.candidate[key], shaPattern);
    assert.equal(receipt.candidate.artifact_sha256, expectedArtifact);
    validateMonitorManifest(canonical(receipt.candidate.artifact), sha256(canonical(receipt.candidate.artifact)));
    assert.equal(receipt.candidate.artifact.artifact_sha256, expectedArtifact);
    assert.equal(receipt.candidate.artifact.source_sha256, receipt.candidate.source_sha256);
    deploymentIdentity(receipt.deployment);
    return receipt;
}

export function deploymentIdentity(deployment) {
    assert.match(deployment.id, /^dpl_[A-Za-z0-9]{8,80}$/);
    assert.match(deployment.url, /^vetios-public-static-[a-z0-9-]+\.vercel\.app$/);
    assert.notEqual(deployment.url, TARGET.domain);
    return deployment;
}

export function inspectDeployment(deployment, candidate, { staged = false } = {}) {
    deploymentIdentity(deployment);
    assert.equal(deployment.projectId, TARGET.project); assert.equal(deployment.target, 'production');
    assert.equal(deployment.readyState, 'READY');
    assert.equal(deployment.meta?.vetiosArtifact, candidate.artifact_sha256);
    assert.equal(deployment.meta?.vetiosSource, candidate.source_sha256);
    assert.equal(deployment.meta?.vetiosOutput, candidate.vercel_output_sha256);
    if (staged) assert.deepEqual(deployment.assignedAliases, [], 'staging must not assign production aliases');
    return { id: deployment.id, url: deployment.url };
}

export function inspectProject(project, domains, mode) {
    assert.equal(project.id, TARGET.project); assert.equal(project.accountId, TARGET.team); assert.equal(project.name, TARGET.name);
    assert.equal(project.framework, null); assert.equal(project.link ?? null, null, 'automatic Git deployment must not bypass the publisher');
    assert.equal(project.env?.length ?? 0, 0, 'static project must not inherit runtime credentials');
    assert.ok(project.ssoProtection?.enabled !== false && ['all', 'all_except_custom_domains'].includes(project.ssoProtection?.deploymentType), 'preview SSO must remain enabled');
    for (const policy of [project.passwordProtection, project.trustedIps]) {
        const explicitlyInactive = policy == null || (typeof policy === 'object' && !Array.isArray(policy)
            && (policy.enabled ?? Boolean(policy.deploymentType)) === false && policy.deploymentType == null);
        assert.ok(explicitlyInactive, 'unexpected additional access policy requires review');
    }
    assert.ok(Array.isArray(domains.domains) && domains.domains.length === 1
        && domains.domains[0].name === TARGET.domain && domains.domains[0].verified === true,
    'only the verified default hostname may be attached to this project');
    assert.ok(!domains.pagination?.next, 'domain inventory must be complete');
    if (['promote', 'rollback'].includes(mode)) {
        assert.equal(project.ssoProtection.deploymentType, 'all_except_custom_domains', 'public-access setting requires separate owner action');
        assert.equal(project.paused, false, 'unpause requires a separate operator decision');
    }
}

export function publicMonitorReady(policy, env, artifact) {
    validateMonitorPolicy(policy); assert.equal(policy.state, 'COMMISSIONED'); assert.equal(policy.provider, 'VERCEL');
    assert.equal(policy.domain, TARGET.domain); assert.equal(env.NONCLINICAL_MONITOR_DOMAIN, TARGET.domain);
    const manifest = validateMonitorManifest(env.NONCLINICAL_MONITOR_MANIFEST, env.NONCLINICAL_MONITOR_MANIFEST_SHA256);
    assert.deepEqual(manifest, artifact, 'public monitor must be pinned to the proposed publication');
}

// Dependencies are injected for adverse mechanics tests. Only the CLI below supplies provider credentials.
export async function deliver({ input, authorize, candidate, prior, provider, audit, commissioning, monitorReady }) {
    releaseInputs(input);
    if (input.mode === 'stage') assert.equal(prior, undefined, 'stage cannot consume a prior release');
    const authorization = await authorize(); assert.ok(authorization.approver_id);
    let commissioningDigest = null;
    if (['promote', 'rollback'].includes(input.mode)) {
        const intake = await commissioning();
        assert.equal(intake?.schema, 'vetios-nonclinical-intake-v1');
        assert.equal(intake.status, 'IMPORTED_UNAPPROVED');
        assert.equal(intake.operational_truth_verified, false); assert.equal(intake.production_authorized, false);
        assert.match(intake.packet_sha256, shaPattern); commissioningDigest = intake.packet_sha256;
    }
    assert.equal(candidate.artifact_sha256, input.artifact_sha256);
    if (input.mode !== 'stage') {
        assert.ok(prior); assert.equal(prior.candidate.artifact_sha256, candidate.artifact_sha256);
        if (input.mode === 'promote') assert.equal(prior.authorization.source_commit, authorization.source_commit, 'staged source is stale');
    }
    const before = await provider.project(); inspectProject(before.project, before.domains, input.mode);
    if (['promote', 'rollback'].includes(input.mode)) await monitorReady(candidate.artifact);
    let deployment = prior?.deployment ?? null;
    if (deployment) {
        const observed = await provider.deployment(deployment.id);
        assert.deepEqual(inspectDeployment(observed, candidate, { staged: input.mode === 'promote' }), deployment);
        if (input.mode !== 'suspend') await provider.probe(deployment, candidate.artifact, true);
    }
    // Exclusive local journal is uploaded by the workflow even after failure. Never silently retry a mutation.
    const common = { schema: 'vetios-vercel-release-v1', target: TARGET, authorization, mode: input.mode,
        candidate, prior_receipt_sha256: input.receipt_sha256 || null, commissioning_packet_sha256: commissioningDigest, clinical_release_authorized: false };
    await audit('intent.json', { ...common, status: 'INTENT_RECORDED', deployment });
    let attempted = false;
    try {
        attempted = true;
        if (input.mode === 'stage') {
            const id = await provider.stage(candidate);
            deployment = inspectDeployment(await provider.deployment(id), candidate, { staged: true });
            await provider.probe(deployment, candidate.artifact, true);
            // Probe and readback must both leave the staged deployment without production aliases.
            inspectDeployment(await provider.deployment(deployment.id), candidate, { staged: true });
        } else if (input.mode === 'suspend') {
            await provider.pause(); await provider.suspended(deployment, prior.status === 'STAGED_VERIFIED');
        } else {
            await provider[input.mode](deployment.id);
            assert.deepEqual(inspectDeployment(await provider.deployment(deployment.id), candidate), deployment);
            await provider.publicAlias(deployment.id);
            await provider.probe(deployment, candidate.artifact, false);
        }
        const after = await provider.project(); inspectProject(after.project, after.domains, input.mode);
        assert.deepEqual(after.project.ssoProtection, before.project.ssoProtection, 'deployment protection changed');
        const result = { ...common, deployment, status: input.mode === 'stage' ? 'STAGED_VERIFIED' : input.mode === 'suspend' ? 'SUSPENDED_VERIFIED' : 'PUBLISHED_VERIFIED' };
        await audit('outcome.json', result); return result;
    } catch {
        // A lost response can mean the provider acted. Do not relabel it as a clean failure or auto-roll back.
        await audit('uncertain.json', { ...common, deployment, status: attempted ? 'UNKNOWN_RECONCILE_REQUIRED' : 'NOT_ATTEMPTED' });
        throw Error('release outcome uncertain; inspect private provider state before a new action');
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
    const command = process.argv[2];
    if (command === 'preflight') {
        releaseInputs(JSON.parse(await regular(process.env.GITHUB_EVENT_PATH)).inputs);
        await sourceAuthorization(); process.stdout.write('Standalone source and release protection verified.\n');
    } else if (command === 'deliver') {
        const [directory, auditDirectory] = process.argv.slice(3); assert.ok(directory && auditDirectory);
        const event = JSON.parse(await regular(process.env.GITHUB_EVENT_PATH));
        const input = releaseInputs(event.inputs);
        // Verify approval before constructing a provider client or opening private commissioning metadata.
        const authorize = () => sourceAuthorization(process.env, undefined, true);
        await authorize();
        let prior, candidate;
        if (input.mode === 'stage') candidate = await qualifiedArtifact(directory, input.artifact_sha256);
        else {
            prior = inspectPrior(await regular(path.join(directory, 'outcome.json')), input.receipt_sha256, input.mode, input.artifact_sha256);
            await trustedPriorRun(input.prior_run, prior); candidate = prior.candidate;
        }
        await fs.mkdir(auditDirectory, { recursive: false, mode: 0o700 });
        const audit = async (name, record) => fs.writeFile(path.join(auditDirectory, name), canonical(record) + '\n', { flag: 'wx', mode: 0o600 });
        const { vercelProvider } = await import('./vercel-provider.mjs');
        const provider = vercelProvider({ directory });
        await deliver({ input, authorize, prior, candidate, provider, audit,
            commissioning: () => approvedCommissioning(process.env.NONCLINICAL_COMMISSIONING_PACKET ?? '', process.env.NONCLINICAL_COMMISSIONING_SHA256),
            monitorReady: async artifact => publicMonitorReady(JSON.parse(await regular(path.join(ROOT, 'monitor-policy.json'))), await repositoryMonitorVariables(), artifact) });
        process.stdout.write('Release action verified; inspect the digest-bound receipt. No additional action was performed.\n');
    } else throw Error('usage: node vercel-release.mjs preflight | deliver EVIDENCE_DIRECTORY NEW_AUDIT_DIRECTORY');
    } catch {
        // Assertion diagnostics can contain private packet values. Retain only sanitized action receipts.
        process.stderr.write('Vercel release blocked or uncertain. Check source/environment policy, exact receipt and private commissioning records; never retry an uncertain provider action.\n');
        process.exitCode = 1;
    }
}

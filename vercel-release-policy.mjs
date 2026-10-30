import assert from 'node:assert/strict';
import { githubGet } from './deploy.mjs';
import { shaPattern } from './policy.mjs';

export const TARGET = Object.freeze({ repository: 'Jaybe-123456/VetIOS-nonclinical', repository_id: 1423681666,
    team: 'team_2hXyZAfOnzEDHqhMTVytianf', project: 'prj_MVmnInTDo2XZAym9MrvQIYx5UXnE',
    name: 'vetios-public-static', domain: 'vetios-public-static.vercel.app',
    environment: 'vetios-public-static-vercel', workflow: '.github/workflows/vercel-publish.yml' });
export const BASE = '/repos/' + TARGET.repository;
export const commitPattern = /^[a-f0-9]{40}$/;
export const idPattern = /^[1-9][0-9]*$/;

export async function pages(get, route) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
        const part = await get(route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
        assert.ok(Array.isArray(part)); all.push(...part);
        if (part.length < 100) return all;
    }
    throw Error('inventory pagination exceeded; cannot assume completeness');
}

export async function sourceAuthorization(env = process.env, get = githubGet, requireApproval = false) {
    assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
    assert.equal(env.GITHUB_REPOSITORY, TARGET.repository); assert.equal(env.GITHUB_REPOSITORY_ID, String(TARGET.repository_id));
    assert.equal(env.GITHUB_REF, 'refs/heads/main'); assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.match(env.GITHUB_SHA, commitPattern); assert.match(env.GITHUB_RUN_ID, idPattern);
    // A re-run must be a new dispatch and a new human decision; approval history lacks attempt identity.
    assert.equal(env.GITHUB_RUN_ATTEMPT, '1', 'dispatch a new release; retries cannot reuse approval');
    const [repo, branch, protection, environment, run] = await Promise.all([
        get(BASE), get(BASE + '/branches/main'), get(BASE + '/branches/main/protection'),
        get(BASE + '/environments/' + TARGET.environment), get(BASE + '/actions/runs/' + env.GITHUB_RUN_ID),
    ]);
    assert.equal(repo.id, TARGET.repository_id); assert.equal(repo.default_branch, 'main'); assert.equal(repo.fork, false);
    assert.equal(branch.commit.sha, env.GITHUB_SHA, 'candidate is no longer main');
    assert.equal(protection.enforce_admins?.enabled, true); assert.equal(protection.allow_force_pushes?.enabled, false);
    assert.equal(protection.allow_deletions?.enabled, false); assert.equal(protection.required_status_checks?.strict, true);
    assert.ok(protection.required_status_checks.checks.some(c => c.context === 'qualify' && c.app_id === 15368), 'required GitHub Actions qualification missing');
    const reviewPolicy = protection.required_pull_request_reviews;
    assert.ok(reviewPolicy?.required_approving_review_count >= 1, 'main must require independent PR approval before publisher credentials');
    assert.equal(reviewPolicy.dismiss_stale_reviews, true); assert.equal(reviewPolicy.require_last_push_approval, true);
    assert.ok(!reviewPolicy.bypass_pull_request_allowances || Object.values(reviewPolicy.bypass_pull_request_allowances).every(v => Array.isArray(v) && !v.length), 'PR review bypass rejected');
    const reviewers = environment.protection_rules.find(r => r.type === 'required_reviewers');
    assert.equal(reviewers?.prevent_self_review, true); assert.ok(reviewers.reviewers.length > 0);
    assert.ok(reviewers.reviewers.every(r => r.type === 'User' && r.reviewer.type === 'User'));
    assert.equal(environment.can_admins_bypass, false);
    assert.equal(environment.deployment_branch_policy?.custom_branch_policies, true);
    const branches = await get(BASE + '/environments/' + TARGET.environment + '/deployment-branch-policies');
    assert.equal(branches.total_count, 1); assert.equal(branches.branch_policies.length, 1);
    assert.equal(branches.branch_policies[0].name, 'main'); assert.equal(branches.branch_policies[0].type, 'branch');
    assert.equal(run.repository.id, TARGET.repository_id); assert.equal(run.head_repository.id, TARGET.repository_id);
    assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.path, TARGET.workflow); assert.equal(run.head_sha, env.GITHUB_SHA);
    assert.equal(run.head_branch, 'main'); assert.equal(run.run_attempt, 1);
    const associated = await pages(get, BASE + '/commits/' + env.GITHUB_SHA + '/pulls');
    const merged = associated.filter(p => p.merged_at && p.merge_commit_sha === env.GITHUB_SHA && p.base.ref === 'main' && p.base.repo.id === TARGET.repository_id && p.head.repo?.id === TARGET.repository_id);
    assert.equal(merged.length, 1, 'exact standalone merge must have a reviewed PR');
    const pr = merged[0], reviews = await pages(get, BASE + '/pulls/' + pr.number + '/reviews');
    const latest = new Map();
    for (const review of reviews.sort((a, b) => a.id - b.id)) if (review.state !== 'COMMENTED') latest.set(review.user.id, review);
    assert.ok([...latest.values()].some(r => r.state === 'APPROVED' && r.commit_id === pr.head.sha && r.user.type === 'User' && r.user.id !== pr.user.id), 'actual independent approval of the merged PR head required');
    const checks = await get(BASE + '/commits/' + env.GITHUB_SHA + '/check-runs?per_page=100');
    assert.ok(checks.total_count <= 100, 'check inventory truncated');
    const qualification = checks.check_runs.filter(c => c.name === 'qualify' && c.app?.id === 15368).sort((a, b) => b.id - a.id)[0];
    assert.equal(qualification?.conclusion, 'success', 'exact main qualification required');
    let approver = null;
    if (requireApproval) {
        const approvals = await get(BASE + '/actions/runs/' + env.GITHUB_RUN_ID + '/approvals');
        const approval = [...approvals].reverse().find(a => a.environments.some(e => e.name === TARGET.environment));
        assert.equal(approval?.state, 'approved'); assert.equal(approval.user.type, 'User');
        assert.ok(reviewers.reviewers.some(r => r.reviewer.id === approval.user.id));
        assert.notEqual(approval.user.id, run.actor.id); assert.notEqual(approval.user.id, run.triggering_actor.id);
        approver = approval.user.id;
    }
    return { source_commit: env.GITHUB_SHA, run_id: env.GITHUB_RUN_ID, attempt: 1, repository_id: TARGET.repository_id, approver_id: approver, pull_request: pr.number };
}

export function releaseInputs(input) {
    assert.ok(['stage', 'promote', 'suspend', 'rollback'].includes(input.mode));
    assert.match(input.artifact_sha256, shaPattern, 'human-selected artifact digest required');
    if (input.mode === 'stage') { assert.equal(input.prior_run ?? '', ''); assert.equal(input.receipt_sha256 ?? '', ''); }
    else { assert.match(input.prior_run, idPattern); assert.match(input.receipt_sha256, shaPattern); }
    if (['promote', 'rollback'].includes(input.mode)) assert.equal(input.public_access, TARGET.domain, 'explicit anonymous publication decision required');
    else assert.equal(input.public_access ?? '', '');
    return input;
}

export async function trustedPriorRun(runId, receipt, get = githubGet) {
    assert.match(runId, idPattern); assert.equal(receipt.authorization.run_id, runId);
    const run = await get(BASE + '/actions/runs/' + runId);
    assert.equal(run.repository.id, TARGET.repository_id); assert.equal(run.head_repository.id, TARGET.repository_id);
    assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.path, TARGET.workflow);
    assert.equal(run.head_branch, 'main'); assert.equal(run.run_attempt, 1); assert.equal(run.conclusion, 'success');
    assert.equal(run.head_sha, receipt.authorization.source_commit); assert.equal(receipt.authorization.attempt, 1);
    assert.ok(Number.isSafeInteger(receipt.authorization.approver_id));
    return run;
}

export async function repositoryMonitorVariables(env = process.env, get = githubGet) {
    const names = ['NONCLINICAL_MONITOR_DOMAIN', 'NONCLINICAL_MONITOR_MANIFEST', 'NONCLINICAL_MONITOR_MANIFEST_SHA256'];
    const records = await Promise.all(names.map(name => get(BASE + '/actions/variables/' + name)));
    const values = {};
    for (let i = 0; i < names.length; i++) {
        assert.equal(records[i].name, names[i]); assert.equal(records[i].value, env[names[i]], 'environment override differs from scheduled monitor configuration');
        values[names[i]] = records[i].value;
    }
    return values;
}

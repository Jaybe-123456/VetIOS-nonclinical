import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { canonical, HEADERS, ROUTES, shaPattern } from './policy.mjs';
import { ROOT, sha256, readSource } from './build.mjs';
import { inspectArtifact, regular } from './deploy.mjs';

const EVIDENCE_SCHEMA = 'vetios-nonclinical-verification-evidence-v1';
const ROUTE_METHODS = ['GET', 'HEAD'];
const FORBIDDEN_CONFIG_KEYS = new Set(['images', 'wildcard', 'overrides', 'cache', 'framework', 'crons', 'services', 'daemons']);

function inside(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function routeConfig() {
    const headers = Object.fromEntries(Object.entries(HEADERS));
    const routes = [{ src: '^/.*$', headers, continue: true }];
    for (const [uri, file] of Object.entries(ROUTES)) {
        const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        routes.push({ src: `^${escaped}$`, caseSensitive: true, methods: ROUTE_METHODS, dest: '/' + file });
        routes.push({ src: `^${escaped}$`, caseSensitive: true, status: 405, headers });
    }
    routes.push({ src: '^/.*$', status: 404, headers });
    return { version: 3, routes };
}

async function noSymlinkParents(file) {
    let current = path.resolve(file);
    while (true) {
        try { assert.equal((await fs.lstat(current)).isSymbolicLink(), false, 'symlink path rejected'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (path.dirname(current) === current) break;
        current = path.dirname(current);
    }
}

async function loadVerificationEvidence(directory, source, artifact) {
    await noSymlinkParents(directory);
    const receipt = JSON.parse(await regular(path.join(directory, 'nonclinical-verification.json')));
    const { receipt_sha256, ...body } = receipt;
    assert.equal(receipt_sha256, sha256(canonical(body)), 'verification receipt integrity mismatch');
    assert.equal(receipt.schema, 'vetios-nonclinical-verification-v1');
    assert.equal(receipt.status, 'PASS');
    assert.equal(receipt.production_authorized, false);
    assert.equal(receipt.production_actions, 0);
    assert.equal(receipt.source_sha256, source.sha256, 'verification source mismatch');
    assert.equal(receipt.artifact_sha256, artifact.artifact_sha256, 'verification artifact mismatch');
    const tap = await regular(path.join(directory, 'contracts.tap'));
    const tapText = tap.toString('utf8');
    const tests = Number(tapText.match(/^# tests (\d+)$/m)?.[1]);
    const passed = Number(tapText.match(/^# pass (\d+)$/m)?.[1]);
    assert.ok(Number.isSafeInteger(tests) && tests >= 161, 'complete executed adverse contracts required');
    assert.equal(passed, tests); assert.match(tapText, /^# fail 0$/m); assert.match(tapText, /^# skipped 0$/m);
    assert.match(tapText, /^# cancelled 0$/m); assert.match(tapText, /^# todo 0$/m);
    assert.doesNotMatch(tapText, /^not ok /m);
    assert.equal(receipt.tests_sha256, sha256(tap), 'test evidence changed');
    assert.equal(receipt.tests, tests); assert.equal(receipt.passed, passed);
    assert.equal(receipt.failed, 0); assert.equal(receipt.skipped, 0);
    const browserBytes = await regular(path.join(directory, 'browser.json'));
    const browser = JSON.parse(browserBytes.toString('utf8'));
    assert.equal(receipt.browser_sha256, sha256(browserBytes), 'browser evidence changed');
    assert.deepEqual(receipt.browser, browser);
    assert.equal(browser.source_sha256, source.sha256, 'browser source mismatch');
    assert.equal(browser.artifact_sha256, artifact.artifact_sha256, 'browser artifact mismatch');
    assert.equal(browser.status, 'PASS'); assert.equal(browser.fixture_only, true);
    assert.equal(browser.clinical_validation, false); assert.equal(browser.production_actions, 0);
    assert.equal(browser.external_requests, 0); assert.deepEqual(browser.page_errors, []); assert.deepEqual(browser.csp_violations, []);
    const expectedCaptures = ['desktop', 'mobile'].flatMap(device =>
        ['home', 'docs', 'demo', 'boundary'].map(page => `${device}-${page}.png`)).sort();
    assert.deepEqual([...browser.captures].sort(), expectedCaptures, 'incomplete or duplicate captures');
    const captures = [];
    for (const name of browser.captures) {
        assert.match(name, /^(?:desktop|mobile)-(?:home|docs|demo|boundary)\.png$/);
        const bytes = await regular(path.join(directory, name));
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG capture required');
        captures.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    assert.deepEqual(receipt.captures, captures.map(({ path, sha256 }) => ({ path, sha256 })), 'capture evidence changed');
    return {
        schema: EVIDENCE_SCHEMA, tests, passed, tests_sha256: sha256(tap),
        browser_sha256: sha256(browserBytes), capture_members: captures,
        browser_status: browser.status, fixture_only: true, clinical_validation: false,
        production_actions: 0,
    };
}

async function collectMembers(root) {
    assert.ok((await fs.lstat(root)).isDirectory(), 'static root must be a real directory');
    const members = [];
    async function walk(directory, prefix = '') {
        for (const item of await fs.readdir(directory, { withFileTypes: true })) {
            const relative = prefix + item.name;
            assert.equal(item.isSymbolicLink(), false, 'Vercel output symlink rejected');
            if (item.isDirectory()) {
                assert.ok(['assets', 'docs', 'demo', 'boundary'].includes(relative), 'unlisted static directory');
                await walk(path.join(directory, item.name), relative + '/');
            }
            else {
                assert.ok(item.isFile(), 'Vercel output special file rejected');
                const bytes = await regular(path.join(root, relative));
                members.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
            }
        }
    }
    await walk(root);
    return members.sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildVercelOutput({ artifactDirectory, verificationDirectory, outputRoot, sourceRoot = ROOT }) {
    outputRoot = path.resolve(outputRoot);
    await noSymlinkParents(outputRoot);
    await noSymlinkParents(sourceRoot);
    assert.equal(inside(sourceRoot, outputRoot), false, 'Vercel output must stay outside the closed source tree');
    assert.equal(path.basename(outputRoot), 'output');
    assert.equal(path.basename(path.dirname(outputRoot)), '.vercel');
    const source = await readSource(sourceRoot);
    const artifact = await inspectArtifact(artifactDirectory, { sourceRoot });
    const evidence = await loadVerificationEvidence(verificationDirectory, source, artifact);
    assert.equal(artifact.source_sha256, source.sha256);
    const parent = path.dirname(outputRoot);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
    const staticRoot = path.join(outputRoot, 'static');
    await fs.mkdir(staticRoot, { mode: 0o700 });
    for (const member of artifact.members) {
        const relative = member.path.split('/').join(path.sep);
        const destination = path.join(staticRoot, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const bytes = await regular(path.join(artifactDirectory, 'public', relative));
        assert.equal(sha256(bytes), member.sha256);
        await fs.writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    }
    const config = routeConfig();
    await fs.writeFile(path.join(outputRoot, 'config.json'), canonical(config) + '\n', { flag: 'wx', mode: 0o600 });
    return inspectVercelOutput({ outputRoot, artifactDirectory, verificationDirectory, sourceRoot });
}

export async function inspectVercelOutput({ outputRoot, artifactDirectory, verificationDirectory, sourceRoot = ROOT }) {
    outputRoot = path.resolve(outputRoot);
    await noSymlinkParents(outputRoot);
    await noSymlinkParents(sourceRoot);
    assert.equal(inside(sourceRoot, outputRoot), false, 'Vercel output inside source tree rejected');
    assert.equal(path.basename(path.dirname(outputRoot)), '.vercel');
    assert.equal(path.basename(outputRoot), 'output');
    const rootEntries = (await fs.readdir(outputRoot)).sort();
    assert.deepEqual(rootEntries, ['config.json', 'static'], 'only Build Output API static files and config are allowed');
    const configBytes = await regular(path.join(outputRoot, 'config.json'));
    const config = JSON.parse(configBytes.toString('utf8'));
    for (const key of Object.keys(config)) assert.equal(FORBIDDEN_CONFIG_KEYS.has(key), false, `dynamic Vercel primitive rejected: ${key}`);
    assert.deepEqual(config, routeConfig(), 'Vercel routing configuration changed');
    const source = await readSource(sourceRoot);
    const artifact = await inspectArtifact(artifactDirectory, { sourceRoot });
    const evidence = await loadVerificationEvidence(verificationDirectory, source, artifact);
    assert.equal(artifact.source_sha256, source.sha256);
    const staticMembers = await collectMembers(path.join(outputRoot, 'static'));
    assert.deepEqual(staticMembers, artifact.members, 'Vercel public output differs from the exact approved static artifact');
    const members = [{ path: 'config.json', bytes: configBytes.length, sha256: sha256(configBytes) },
        ...staticMembers.map(member => ({ ...member, path: 'static/' + member.path }))]
        .sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
        schema: 'vetios-vercel-static-output-v1', source_sha256: source.sha256,
        artifact_sha256: artifact.artifact_sha256, verification_evidence: evidence, members,
    };
    return { ...manifest, vercel_output_sha256: sha256(canonical(manifest)), production_authorized: false };
}

export { routeConfig };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 5) throw Error('usage: node vercel.mjs ARTIFACT_DIRECTORY VERIFICATION_DIRECTORY NEW_OUTPUT/.vercel/output');
    const [artifactDirectory, verificationDirectory, outputRoot] = process.argv.slice(2);
    process.stdout.write(canonical(await buildVercelOutput({ artifactDirectory, verificationDirectory, outputRoot })) + '\n');
}

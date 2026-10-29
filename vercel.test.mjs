import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build, ROOT, sha256 } from './build.mjs';
import { canonical, ROUTES, HEADERS } from './policy.mjs';
import { startServer } from './serve.mjs';
import { buildVercelOutput, inspectVercelOutput, routeConfig } from './vercel.mjs';
import { vercelProvider } from './vercel-provider.mjs';
import { TARGET } from './vercel-release-policy.mjs';

async function fixture(fn) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vetios-vercel-output-'));
    try {
        const artifactDirectory = path.join(root, 'candidate');
        const verificationDirectory = path.join(root, 'verification');
        const outputRoot = path.join(root, '.vercel', 'output');
        await fs.mkdir(verificationDirectory, { mode: 0o700 });
        const count = 241;
        const tap = `TAP version 13\n1..${count}\n# tests ${count}\n# pass ${count}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
        await fs.writeFile(path.join(verificationDirectory, 'contracts.tap'), tap, { mode: 0o600 });
        const captures = [];
        for (const device of ['desktop', 'mobile']) for (const page of ['home', 'docs', 'demo', 'boundary']) {
            const name = `${device}-${page}.png`; captures.push(name);
            await fs.writeFile(path.join(verificationDirectory, name), Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), Buffer.from(name)]), { mode: 0o600 });
        }
        const artifact = await build(artifactDirectory);
        await fs.writeFile(path.join(verificationDirectory, 'browser.json'), canonical({source_sha256:artifact.source_sha256, artifact_sha256:artifact.artifact_sha256, status: 'PASS', fixture_only: true,
            clinical_validation: false, production_actions: 0, external_requests: 0, page_errors: [], csp_violations: [], captures }) + '\n', { mode: 0o600 });
        await sealFixture(verificationDirectory,artifact);
        return await fn({ root, artifactDirectory, verificationDirectory, outputRoot, artifact });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('Vercel Build Output API contains only exact static public bytes and strict route configuration', () => fixture(async f => {
    const result = await buildVercelOutput(f);
    assert.equal(result.production_authorized, false);
    assert.equal(result.artifact_sha256, f.artifact.artifact_sha256);
    assert.ok(result.members.some(member => member.path === 'static/index.html'));
    assert.equal(result.members.some(member => member.path.includes('artifact.json')), false);
    assert.deepEqual((await fs.readdir(f.outputRoot)).sort(), ['config.json', 'static']);
    assert.deepEqual(await inspectVercelOutput(f), result);
}));

test('route configuration permits only exact GET and HEAD static routes', () => {
    const config = routeConfig();
    assert.deepEqual(Object.keys(config), ['version', 'routes']);
    assert.equal(config.version, 3);
    for (const [uri, file] of Object.entries(ROUTES)) {
        const staticRoute = config.routes.find(route => route.src === `^${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` && route.dest === '/' + file);
        assert.ok(staticRoute); assert.deepEqual(staticRoute.methods, ['GET', 'HEAD']);
        assert.equal(config.routes.some(route => route.src === `^${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` && route.status === 405), true);
    }
    assert.deepEqual(config.routes[0].headers, HEADERS);
    assert.equal(config.routes[0].continue, true);
    assert.deepEqual(config.routes.at(-1), { src: '^/.*$', status: 404, headers: HEADERS });
});

test('missing or failing verification evidence blocks Vercel output creation', () => fixture(async f => {
    await fs.writeFile(path.join(f.verificationDirectory, 'contracts.tap'), 'TAP version 13\n# tests 160\n# pass 159\n# fail 1\n# skipped 0\n');
    await assert.rejects(() => buildVercelOutput(f));
    await assert.rejects(() => fs.stat(f.outputRoot), { code: 'ENOENT' });
}));

test('incomplete browser evidence blocks Vercel output creation', () => fixture(async f => {
    const browser = JSON.parse(await fs.readFile(path.join(f.verificationDirectory, 'browser.json'), 'utf8'));
    browser.production_actions = 1;
    await fs.writeFile(path.join(f.verificationDirectory, 'browser.json'), canonical(browser));
    await assert.rejects(() => buildVercelOutput(f));
}));

for (const [key, value] of [['clinical_validation', true], ['external_requests', 1], ['fixture_only', false]]) {
    test(`browser evidence rejects ${key}=${value}`, () => fixture(async f => {
        const browser = JSON.parse(await fs.readFile(path.join(f.verificationDirectory, 'browser.json'), 'utf8'));
        browser[key] = value; await fs.writeFile(path.join(f.verificationDirectory, 'browser.json'), canonical(browser));
        await assert.rejects(() => buildVercelOutput(f));
    }));
}

test('stale output cannot be overwritten or rebuilt in place', () => fixture(async f => {
    await buildVercelOutput(f);
    await assert.rejects(() => buildVercelOutput(f));
}));

test('provider adapter uploads only the inspected eight prebuilt members once without production aliasing', () => fixture(async f => {
    const directory = path.join(f.root, 'delivery'), qualified = path.join(directory, 'qualified');
    await fs.cp(f.verificationDirectory, qualified, { recursive: true });
    await fs.cp(f.artifactDirectory, path.join(qualified, 'candidate'), { recursive: true });
    const outputRoot = path.join(qualified, 'vercel/.vercel/output');
    const output = await buildVercelOutput({ artifactDirectory: path.join(qualified, 'candidate'), verificationDirectory: qualified, outputRoot });
    let creates = 0;
    const request = async (url, options) => {
        const u = new URL(url); assert.equal(u.origin, 'https://api.vercel.com'); assert.equal(u.searchParams.get('teamId'), TARGET.team);
        assert.equal(options.redirect, 'error');
        if (options.method === 'POST') {
            creates++; assert.equal(u.pathname, '/v13/deployments'); assert.equal(u.searchParams.get('prebuilt'), '1');
            const body = JSON.parse(options.body); assert.equal(body.project, TARGET.project); assert.equal(body.target, 'production');
            assert.equal(body.autoAssignCustomDomains, false); assert.equal(body.files.length, 8);
            assert.equal(body.env, undefined); assert.equal(body.build, undefined); assert.equal(body.gitSource, undefined);
            for (const member of body.files) {
                assert.ok(member.file.startsWith('.vercel/output/')); assert.equal(member.encoding, 'base64');
                assert.equal(member.mode, 0o100644);
                const local = await fs.readFile(path.join(outputRoot, member.file.slice('.vercel/output/'.length)));
                assert.deepEqual(Buffer.from(member.data, 'base64'), local);
            }
            return Response.json({ id: 'dpl_synthetic123', projectId: TARGET.project, url: 'vetios-public-static-synthetic.vercel.app' });
        }
        assert.equal(u.pathname, '/v13/deployments/dpl_synthetic123'); return Response.json({ readyState: 'READY' });
    };
    const provider = vercelProvider({ directory, env: { VERCEL_TOKEN: 'synthetic-test-only' }, request });
    assert.equal(await provider.stage(output), 'dpl_synthetic123'); assert.equal(creates, 1);
    await fs.appendFile(path.join(outputRoot, 'static/index.html'), 'changed');
    await assert.rejects(() => provider.stage(output)); assert.equal(creates, 1, 'changed bytes never reach provider');
}));

test('function, cron, proxy, middleware and arbitrary config primitives fail closed', () => fixture(async f => {
    await buildVercelOutput(f);
    for (const key of ['functions', 'crons', 'services', 'daemons', 'middlewarePath', 'rewrites', 'images']) {
        const candidate = path.join(f.root, `${key}-case`, '.vercel', 'output');
        await fs.cp(f.outputRoot, candidate, { recursive: true });
        const configPath = path.join(candidate, 'config.json');
        const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config[key] = [];
        await fs.writeFile(configPath, canonical(config));
        await assert.rejects(() => inspectVercelOutput({ ...f, outputRoot: candidate }), /dynamic Vercel primitive|routing configuration changed/);
    }
}));

test('any functions tree is rejected even when static members match', () => fixture(async f => {
    await buildVercelOutput(f);
    await fs.mkdir(path.join(f.outputRoot, 'functions', 'api', 'inference.func'), { recursive: true });
    await fs.writeFile(path.join(f.outputRoot, 'functions', 'api', 'inference.func', '.vc-config.json'), '{}');
    await assert.rejects(() => inspectVercelOutput(f), /only Build Output API static files/);
}));

test('additional static canary and stale content fail exact member comparison', () => fixture(async f => {
    await buildVercelOutput(f);
    await fs.writeFile(path.join(f.outputRoot, 'static', 'canary.txt'), 'must never deploy');
    await assert.rejects(() => inspectVercelOutput(f), /exact approved static artifact/);
}));

test('modified static bytes fail exact member comparison', () => fixture(async f => {
    await buildVercelOutput(f);
    await fs.appendFile(path.join(f.outputRoot, 'static', 'index.html'), '<script>unexpected</script>');
    await assert.rejects(() => inspectVercelOutput(f), /exact approved static artifact/);
}));

test('unlisted public artifact members are rejected before Vercel packaging', () => fixture(async f => {
    await fs.writeFile(path.join(f.artifactDirectory, 'public', 'patient.json'), '{"patient":"fixture"}');
    await assert.rejects(() => buildVercelOutput(f));
}));

test('symlinks in output are rejected', () => fixture(async f => {
    await buildVercelOutput(f);
    await fs.symlink(path.join(f.outputRoot, 'static', 'index.html'), path.join(f.outputRoot, 'static', 'linked.html'));
    await assert.rejects(() => inspectVercelOutput(f));
}));

test('source directory cannot contain Vercel output', () => fixture(async f => {
    await assert.rejects(() => buildVercelOutput({ ...f, outputRoot: path.join(ROOT, '.vercel', 'output') }), /outside the closed source tree/);
}));

test('Vercel output must use the exact Build Output API directory name', () => fixture(async f => {
    await assert.rejects(() => buildVercelOutput({ ...f, outputRoot: path.join(f.root, 'not-output') }));
}));

// Authored mechanics fixtures only; never operational proof or release authority.
async function sealFixture(directory, artifact) {
    const tap=await fs.readFile(path.join(directory,'contracts.tap'));
    const browserBytes=await fs.readFile(path.join(directory,'browser.json'));
    const browser=JSON.parse(browserBytes);
    const captures=[];
    for(const name of browser.captures) captures.push({path:name,sha256:sha256(await fs.readFile(path.join(directory,name)))});
    const receipt={schema:'vetios-nonclinical-verification-v1',status:'PASS',tests:241,passed:241,failed:0,skipped:0,
        source_sha256:artifact.source_sha256,artifact_sha256:artifact.artifact_sha256,
        tests_sha256:sha256(tap),browser_sha256:sha256(browserBytes),browser,captures,production_authorized:false,production_actions:0};
    receipt.receipt_sha256=sha256(canonical(receipt));
    await fs.writeFile(path.join(directory,'nonclinical-verification.json'),canonical(receipt));
}
for(const field of ['source_sha256','artifact_sha256']) test(`stale ${field} evidence fails even with an intact receipt`,()=>fixture(async f=>{
    const file=path.join(f.verificationDirectory,'browser.json');const browser=JSON.parse(await fs.readFile(file));
    browser[field]='f'.repeat(64);await fs.writeFile(file,canonical(browser));await sealFixture(f.verificationDirectory,{...f.artifact,[field]:'f'.repeat(64)});
    await assert.rejects(()=>buildVercelOutput(f),/verification (source|artifact) mismatch/);
}));
test('duplicate browser capture cannot substitute for a missing page',()=>fixture(async f=>{
    const file=path.join(f.verificationDirectory,'browser.json');const browser=JSON.parse(await fs.readFile(file));
    browser.captures[1]=browser.captures[0];await fs.writeFile(file,canonical(browser));await sealFixture(f.verificationDirectory,f.artifact);
    await assert.rejects(()=>buildVercelOutput(f),/duplicate captures/);
}));
test('tampered screenshot fails receipt binding',()=>fixture(async f=>{
    await fs.appendFile(path.join(f.verificationDirectory,'mobile-home.png'),'modified');
    await assert.rejects(()=>buildVercelOutput(f),/capture evidence changed/);
}));
test('symlinked output parent is rejected before copying bytes',()=>fixture(async f=>{
    const link=path.join(f.root,'linked');await fs.symlink(ROOT,link);
    await assert.rejects(()=>buildVercelOutput({...f,outputRoot:path.join(link,'.vercel','output')}),/symlink path/);
}));
test('symlinked static root is rejected even when bytes match',()=>fixture(async f=>{
    await buildVercelOutput(f);const dir=path.join(f.outputRoot,'static');
    await fs.rename(dir,path.join(f.root,'moved'));await fs.symlink(path.join(f.root,'moved'),dir);
    await assert.rejects(()=>inspectVercelOutput(f),/real directory/);
}));
test('unlisted empty static directory is rejected',()=>fixture(async f=>{
    await buildVercelOutput(f);await fs.mkdir(path.join(f.outputRoot,'static','api'));
    await assert.rejects(()=>inspectVercelOutput(f),/unlisted static directory/);
}));

test('real HTTP static routing preserves method, case and private-path boundaries',()=>fixture(async f=>{
    const server=await startServer(f.artifactDirectory,f.artifact,{routeProvider:'vercel'});
    try {
        for(const [method,url,status] of [['GET','/',200],['HEAD','/docs/',200],['POST','/',405],['GET','/DOCS/',404],['GET','/api/inference',404],['POST','/api/inference',404],['GET','/.env',404],['GET','/artifact.json',404]]) {
            const response=await fetch(server.url+url,{method});assert.equal(response.status,status,method+' '+url);
            assert.equal(response.headers.get('content-security-policy'),HEADERS['content-security-policy']);
            if(method==='HEAD')assert.equal(await response.text(),'');
        }
    } finally {await server.close();}
}));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { edgeHandler } from './serve.mjs';
import { HEADERS,ROUTES } from './policy.mjs';
import { build,ROOT,readSource } from './build.mjs';
import { inspectArtifact } from './deploy.mjs';
import { exportSource } from './export.mjs';
import { template } from './infrastructure.mjs';
const digest='a'.repeat(64);
for(const uri of ['/api/inference','/api/outcomes','/api/federation','/admin','/operator','/auth/login','/.env','/releases/'+digest+'/index.html','/assets/../api/inference','/%61pi/inference','/demo/%2e%2e/api/inference','//api/inference','/DEMO/','/unknown'])test('server rejects '+uri,async()=>{const r=await edgeHandler(digest)({method:'GET',uri,headers:{}});assert.equal(r.statusCode,403);assert.equal(r.headers['content-security-policy'].value,HEADERS['content-security-policy']);});
for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','CONNECT'])test('server rejects method '+method,async()=>assert.equal((await edgeHandler(digest)({method,uri:'/',headers:{}})).statusCode,403));
for(const pointer of [null,'','https://clinical.example','../../api','a'.repeat(63),'A'.repeat(64)])test('bad or missing pointer fails closed '+String(pointer).slice(0,15),async()=>assert.equal((await edgeHandler(pointer)({method:'GET',uri:'/',headers:{}})).statusCode,503));
test('every allowed route is rewritten to a fixed digest path and credentials removed',async()=>{
    for(const [uri,file] of Object.entries(ROUTES))for(const method of ['GET','HEAD']){const r=await edgeHandler(digest)({method,uri,headers:{cookie:{value:'private'}},cookies:{session:{value:'private'}},querystring:{origin:{value:'clinical'}}});assert.equal(r.uri,'/releases/'+digest+'/'+file);assert.deepEqual(Object.keys(r.cookies),[]);assert.deepEqual(Object.keys(r.querystring),[]);assert.equal(r.headers.cookie,undefined);}
});
test('authorization header fails at the server boundary',async()=>assert.equal((await edgeHandler(digest)({method:'GET',uri:'/',headers:{authorization:{value:'Bearer AUTHORED'}}})).statusCode,403));
async function fixture(fn){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vetios-static-contract-'));try{return await fn(temp);}finally{await fs.rm(temp,{recursive:true,force:true});}}
test('artifact alteration is rejected from actual bytes',()=>fixture(async dir=>{const out=path.join(dir,'build');await build(out);await fs.appendFile(path.join(out,'public/index.html'),'changed');await assert.rejects(()=>inspectArtifact(out));}));
test('extra clinical payload is rejected',()=>fixture(async dir=>{const out=path.join(dir,'build');await build(out);await fs.writeFile(path.join(out,'public/patient.json'),'{}');await assert.rejects(()=>inspectArtifact(out));}));
test('artifact symlink is rejected',()=>fixture(async dir=>{const out=path.join(dir,'build');await build(out);await fs.unlink(path.join(out,'public/assets/demo.js'));await fs.symlink(path.join(ROOT,'site/assets/demo.js'),path.join(out,'public/assets/demo.js'));await assert.rejects(()=>inspectArtifact(out));}));
test('source export excludes parent history and is exact',()=>fixture(async dir=>{const out=path.join(dir,'export');const before=await exportSource(out);assert.deepEqual(await readSource(out),before);await assert.rejects(()=>fs.stat(path.join(out,'.git')));}));
test('unknown source and source symlink fail closed',()=>fixture(async dir=>{const out=path.join(dir,'export');await exportSource(out);await fs.writeFile(path.join(out,'hidden.mjs'),'');await assert.rejects(()=>readSource(out));await fs.unlink(path.join(out,'hidden.mjs'));await fs.unlink(path.join(out,'policy.mjs'));await fs.symlink(path.join(ROOT,'policy.mjs'),path.join(out,'policy.mjs'));await assert.rejects(()=>readSource(out));}));
test('artifact provenance changes when source changes',()=>fixture(async dir=>{const out=path.join(dir,'export');await exportSource(out);const before=await readSource(out);await fs.appendFile(path.join(out,'README.md'),'\nreviewed change\n');assert.notEqual((await readSource(out)).sha256,before.sha256);}));
test('template contains no clinical compute or wildcard allow permissions',()=>{
    const t=template();const allowed=['AWS::S3::Bucket','AWS::S3::BucketPolicy','AWS::CloudFront::KeyValueStore','AWS::CloudFront::Function','AWS::CloudFront::OriginAccessControl','AWS::CloudFront::ResponseHeadersPolicy','AWS::CloudFront::CachePolicy','AWS::CloudFront::Distribution','AWS::IAM::OIDCProvider','AWS::IAM::ManagedPolicy','AWS::IAM::Role'];
    for(const r of Object.values(t.Resources))assert.ok(allowed.includes(r.Type));
    const p=t.Resources.Publisher.Properties;assert.deepEqual(p.PermissionsBoundary,{Ref:'PublisherBoundary'});
    assert.deepEqual(p.Policies[0].PolicyDocument,t.Resources.PublisherBoundary.Properties.PolicyDocument);
    for(const statement of p.Policies[0].PolicyDocument.Statement){assert.notEqual(statement.Resource,'*');if(statement.Effect==='Allow')for(const action of statement.Action)assert.ok(!action.includes('*')&&!/Delete|UpdateDistribution|PublishFunction|AssumeRole$/.test(action));else {assert.equal(statement.Effect,'Deny');assert.ok(statement.Action.includes('s3:BypassGovernanceRetention'));assert.ok(statement.Action.includes('s3:DeleteObjectVersion'));}}
    assert.equal(t.Resources.Distribution.Properties.DistributionConfig.Origins.length,1);assert.equal(t.Resources.Audit.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Mode,'GOVERNANCE');
});

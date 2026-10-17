// All provider responses and approvals here are authored fixtures. These tests grant no authority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build,sha256 } from './build.mjs';
import { canonical } from './policy.mjs';
import { publish,publicationAuthorization,health,suspendedHealth } from './deploy.mjs';
import { startServer } from './serve.mjs';
const c={schema:'vetios-nonclinical-deployment-v2',status:'COMMISSIONED_NONCLINICAL',project_id:'845081398643',region:'eu-north-1',repository:'authored-fixture/public',repository_id:123,human_deployer_ids:[456],content_bucket:'vetios-nonclinical-fixture-content',audit_bucket:'vetios-nonclinical-fixture-audit',kvs_arn:'arn:aws:cloudfront::845081398643:key-value-store/authored',distribution_id:'AUTHORED123',domain:'dauthored123.cloudfront.net',publisher_role_arn:'arn:aws:iam::845081398643:role/authored',guard_function_arn:'arn:aws:cloudfront::845081398643:function/authored',headers_policy_id:'authored-headers',cache_policy_id:'authored-cache',monitoring_owner:'fixture only',security_review_record_sha256:'a'.repeat(64),bootstrap_record_sha256:'b'.repeat(64),content_privacy_approval_sha256:'c'.repeat(64),publication_approval_sha256:null};
const authorization={run_id:'101',attempt:'1',source_commit:'d'.repeat(40),approver_id:456,repository_id:123};
async function fixture(fn){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vetios-commissioning-'));try{const directory=path.join(temp,'candidate');const artifact=await build(directory);return await fn({directory,artifact});}finally{await fs.rm(temp,{recursive:true,force:true});}}
function writtenRecord(artifact,overrides={}){
    return {schema:'vetios-nonclinical-publication-approval-v1',status:'APPROVED',scope:'NONCLINICAL_STATIC_ONLY',environment:'vetios-nonclinical-production',project_id:c.project_id,region:c.region,repository_id:c.repository_id,source_commit:authorization.source_commit,source_sha256:artifact.source_sha256,artifact_sha256:artifact.artifact_sha256,mode:'publish',approver_id:456,config_sha256:sha256(canonical(Object.fromEntries(Object.entries(c).filter(([key])=>!key.endsWith('_sha256'))))),issued_at:'2020-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',...overrides};
}
test('financial permission and missing written publication approval cannot activate content',()=>fixture(async({directory,artifact})=>{
    let writes=0;const aws={put:async()=>{writes++;}};
    await assert.rejects(()=>publish({c,directory,expectedArtifact:artifact.artifact_sha256,aws,authorize:async()=>authorization,preflight:async()=>{},probe:async()=>({status:'OBSERVED_HEALTHY'})}),/written publication approval/);assert.equal(writes,0);
}));
test('source, artifact, environment and actual approver are bound by the written approval',()=>fixture(async({artifact})=>{
    const bytes=Buffer.from(canonical(writtenRecord(artifact)));const config={...c,publication_approval_sha256:sha256(bytes)};
    const record=await publicationAuthorization(config,{get:async()=>bytes},artifact,authorization,'publish');assert.equal(record.artifact_sha256,artifact.artifact_sha256);
}));
for(const [key,value]of [['source_commit','e'.repeat(40)],['artifact_sha256','e'.repeat(64)],['environment','clinical-production'],['project_id','679583587696'],['approver_id',999],['expires_at','2000-01-01T00:00:00Z'],['mode','rollback'],['issued_at','2099-01-01T00:00:00Z']])test('written approval rejects changed '+key,()=>fixture(async({artifact})=>{
    const bytes=Buffer.from(canonical(writtenRecord(artifact,{[key]:value})));
    await assert.rejects(()=>publicationAuthorization({...c,publication_approval_sha256:sha256(bytes)},{get:async()=>bytes},artifact,authorization,'publish'));
}));
function memoryAws(){const objects=new Map(),calls=[];let pointer=null,visiblePointer=null,delay=false,etag=1,loseNextResponse=false;
    return {objects,calls,get pointer(){return pointer;},get visiblePointer(){return visiblePointer;},delayPropagation(){delay=true;},completePropagation(){visiblePointer=pointer;delay=false;},get etag(){return etag;},loseResponse(){loseNextResponse=true;},
        get:async(bucket,key)=>{const bytes=objects.get(bucket+'/'+key);if(!bytes)throw Error('fixture missing');return bytes;},
        put:async(bucket,key,body)=>{calls.push({op:'put',bucket,key});if(objects.has(bucket+'/'+key))throw Error('immutable precondition');objects.set(bucket+'/'+key,Buffer.from(body));},
        call:async(_service,op,input)=>{calls.push({op,input});if(op==='describe-key-value-store')return {ETag:String(etag)};
            assert.equal(op,'put-key');assert.equal(input.IfMatch,String(etag),'conditional pointer race');pointer=input.Value;if(!delay)visiblePointer=pointer;etag++;
            if(loseNextResponse){loseNextResponse=false;throw Error('fixture timeout after commit');}return {ETag:String(etag)};}
    };
}
async function operationFixture(fn){return fixture(async({directory,artifact})=>{
    const aws=memoryAws();const server=await startServer(directory,artifact,{pointer:()=>aws.visiblePointer});
    const request=(url,options)=>fetch(server.url+new URL(url).pathname,options);
    const invoke=(mode,attempt,extra={})=>publish({c,directory,expectedArtifact:artifact.artifact_sha256,mode,aws,authorize:async()=>({...authorization,attempt:String(attempt)}),preflight:async()=>{},approvePublication:async()=>{},probe:(a,m)=>m==='suspend'?suspendedHealth(c,a,request):health(c,a,request),...extra});
    try{await fn({aws,server,artifact,request,invoke});}finally{await server.close();}
});}
test('first release suspends without an earlier healthy artifact and serves real HTTP 503',()=>operationFixture(async({aws,server,request,artifact,invoke})=>{
    assert.equal((await fetch(server.url+'/')).status,503);const result=await invoke('suspend',1);
    assert.equal(result.status,'OBSERVED_SUSPENDED');assert.equal(aws.pointer,'SUSPENDED');assert.equal(result.public_content_exposed,false);
    assert.equal(aws.calls.filter(call=>call.op==='put'&&call.bucket===c.content_bucket).length,0);assert.equal(aws.calls.filter(call=>call.op==='put-key').length,1);
    assert.equal((await fetch(server.url+'/api/inference',{method:'POST'})).status,403);await suspendedHealth(c,artifact,request);
}));
test('suspension audit failure prevents a pointer update',()=>operationFixture(async({aws,invoke})=>{
    aws.put=async()=>{throw Error('fixture audit unavailable');};await assert.rejects(()=>invoke('suspend',1));assert.equal(aws.calls.filter(call=>call.op==='put-key').length,0);assert.equal(aws.pointer,null);
}));
test('UNKNOWN suspension is never retried and needs a new human-approved attempt',()=>operationFixture(async({aws,invoke,server})=>{
    aws.loseResponse();await assert.rejects(()=>invoke('suspend',1));assert.equal(aws.calls.filter(call=>call.op==='put-key').length,1);
    assert.equal(JSON.parse(aws.objects.get(c.audit_bucket+'/audit/101-1/outcome.json')).status,'UNKNOWN');assert.equal((await fetch(server.url+'/')).status,503);
    await assert.rejects(()=>invoke('suspend',1));assert.equal(aws.calls.filter(call=>call.op==='put-key').length,1);
    assert.equal((await invoke('suspend',2)).status,'OBSERVED_SUSPENDED');assert.equal(aws.calls.filter(call=>call.op==='put-key').length,2);
}));
test('suspension probe rejects a still-propagating public page',()=>fixture(async({artifact})=>assert.rejects(()=>suspendedHealth(c,artifact,async()=>({status:200})))));
test('recovery cannot skip separate written approval; approved activation establishes first healthy baseline',()=>operationFixture(async({aws,invoke,artifact,server})=>{
    await invoke('suspend',1);const writes=aws.calls.length;
    await assert.rejects(()=>invoke('publish',2,{approvePublication:publicationAuthorization}),/written publication approval/);assert.equal(aws.calls.length,writes);assert.equal((await fetch(server.url+'/')).status,503);
    const result=await invoke('publish',3);assert.equal(result.status,'OBSERVED_HEALTHY');assert.equal(aws.pointer,artifact.artifact_sha256);assert.equal((await fetch(server.url+'/')).status,200);
    const baseline=JSON.parse(aws.objects.get(c.audit_bucket+'/audit/101-3/outcome.json'));assert.equal(baseline.artifact_sha256,artifact.artifact_sha256);assert.equal(baseline.status,'OBSERVED_HEALTHY');
}));
test('subsequent rollback uses the healthy receipt; no first-release baseline is invented',()=>operationFixture(async({aws,invoke,artifact})=>{
    await assert.rejects(()=>invoke('rollback',1,{priorReceipt:'audit/101-0/outcome.json'}));assert.equal(aws.calls.filter(call=>call.op==='put-key').length,0);
    await invoke('publish',2);await invoke('suspend',3);
    assert.equal((await invoke('rollback',4,{priorReceipt:'audit/101-2/outcome.json'})).status,'OBSERVED_HEALTHY');assert.equal(aws.pointer,artifact.artifact_sha256);
}));

test('real HTTP propagation delay preserves UNKNOWN; later observation cannot rewrite audit history',()=>operationFixture(async({aws,invoke,artifact,request,server})=>{
    await invoke('suspend',1);aws.delayPropagation();await assert.rejects(()=>invoke('publish',2));assert.equal(aws.pointer,artifact.artifact_sha256);assert.equal((await fetch(server.url+'/')).status,503);
    const key=c.audit_bucket+'/audit/101-2/outcome.json';const unknown=Buffer.from(aws.objects.get(key));assert.equal(JSON.parse(unknown).status,'UNKNOWN');assert.equal(aws.calls.filter(call=>call.op==='put-key').length,2);
    aws.completePropagation();assert.equal((await health(c,artifact,request)).status,'OBSERVED_HEALTHY');assert.deepEqual(aws.objects.get(key),unknown);assert.equal(aws.calls.filter(call=>call.op==='put-key').length,2);
    assert.equal((await invoke('publish',3)).status,'OBSERVED_HEALTHY');assert.deepEqual(aws.objects.get(key),unknown);
}));

test('written authorization expiring during intent persistence prevents activation',()=>operationFixture(async({aws,invoke})=>{
    let checks=0;await assert.rejects(()=>invoke('publish',1,{approvePublication:async()=>{if(++checks===3)throw Error('fixture approval expired during audit write');}}));
    assert.equal(checks,3);assert.equal(aws.calls.filter(call=>call.op==='put-key').length,0);const outcome=JSON.parse(aws.objects.get(c.audit_bucket+'/audit/101-1/outcome.json'));assert.equal(outcome.status,'NOT_ATTEMPTED');assert.equal(outcome.pointer_mutation_attempted,false);
}));

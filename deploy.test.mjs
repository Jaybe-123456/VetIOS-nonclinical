import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig,humanAuthorization,publish,health } from './deploy.mjs';
import { build } from './build.mjs';
import { HEADERS,ROUTES } from './policy.mjs';
const config={schema:'vetios-nonclinical-deployment-v2',status:'COMMISSIONED_NONCLINICAL',project_id:'845081398643',region:'eu-north-1',repository:'authored-fixture/public',repository_id:123,human_deployer_ids:[456],content_bucket:'vetios-nonclinical-fixture-content',audit_bucket:'vetios-nonclinical-fixture-audit',kvs_arn:'arn:aws:cloudfront::845081398643:key-value-store/authored',distribution_id:'AUTHORED123',domain:'dauthored123.cloudfront.net',publisher_role_arn:'arn:aws:iam::845081398643:role/authored',guard_function_arn:'arn:aws:cloudfront::845081398643:function/authored',headers_policy_id:'authored-headers',cache_policy_id:'authored-cache',monitoring_owner:'fixture only',security_review_record_sha256:'a'.repeat(64),bootstrap_record_sha256:'b'.repeat(64),content_privacy_approval_sha256:'c'.repeat(64),publication_approval_sha256:null};
for(const [key,value]of [['status','NOT_COMMISSIONED'],['project_id','679583587696'],['region','us-east-1'],['repository','Karshadev/VetIOS'],['repository_id',1161119818],['content_bucket','clinical-storage'],['domain','clinical.example'],['human_deployer_ids',[]],['bootstrap_record_sha256',null]])test('configuration rejects '+key,()=>assert.throws(()=>validateConfig({...config,[key]:value})));
test('unknown configuration credentials cannot enter',()=>assert.throws(()=>validateConfig({...config,secret:'AUTHORED'})));
test('local CLI cannot impersonate GitHub approval',async()=>{let calls=0;await assert.rejects(()=>humanAuthorization(config,{},async()=>{calls++;}));assert.equal(calls,0);});
const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:config.repository,GITHUB_REPOSITORY_ID:'123',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'101',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'d'.repeat(40)};
function github(overrides={}) {return async route=>{
    const fixtures={
        '':{id:123,default_branch:'main'},'/branches/main':{commit:{sha:env.GITHUB_SHA}},
        '/environments/vetios-nonclinical-production':{can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:true},protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:456}}]}]},
        '/actions/oidc/customization/sub':{use_default:false,include_claim_keys:['repository_id','context']},
        '/actions/runs/101':{event:'workflow_dispatch',head_sha:env.GITHUB_SHA,head_branch:'main',run_attempt:1,path:'.github/workflows/nonclinical.yml',repository:{id:123}},
        '/actions/runs/101/approvals':[{state:'approved',environments:[{name:'vetios-nonclinical-production'}],user:{type:'User',id:456}}],
        '/branches/main/protection':{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_status_checks:{strict:true,contexts:['qualify']}},
        '/environments/vetios-nonclinical-production/deployment-branch-policies':{branch_policies:[{name:'main',type:'branch'}]},
    };
    const key=route.slice(('/repos/'+config.repository).length);if(key in overrides)return overrides[key];assert.ok(key in fixtures,key);return fixtures[key];
};}
test('actual current manual run and protected human environment are admitted',async()=>assert.equal((await humanAuthorization(config,env,github())).approver_id,456));
for(const [key,value]of [['/actions/runs/101/approvals',[]],['/branches/main',{commit:{sha:'e'.repeat(40)}}],['/actions/oidc/customization/sub',{use_default:true}],['/branches/main/protection',{}],['/environments/vetios-nonclinical-production',{protection_rules:[],can_admins_bypass:true}]])test('missing or stale authorization rejects '+key,async()=>assert.rejects(()=>humanAuthorization(config,env,github({[key]:value}))));
async function candidate(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vetios-publish-contract-'));try{const out=path.join(dir,'artifact');const artifact=await build(out);return await fn(out,artifact);}finally{await fs.rm(dir,{recursive:true,force:true});}}
function fakeAws({intentFail=false,pointerFail=false}={}){const operations=[];return {operations,put:async(bucket,key,body)=>{operations.push({op:'put',bucket,key,body:body?.toString()});if(intentFail&&key.endsWith('intent.json'))throw Error('audit unavailable');},get:async()=>{throw Error('not found');},call:async(service,op,input)=>{operations.push({op,input});if(op==='put-key'&&pointerFail)throw Error('ambiguous timeout');return {ETag:'fixture-etag'};}};}
const authorization={run_id:'101',attempt:'1',source_commit:env.GITHUB_SHA,approver_id:456,repository_id:123};
test('failed preflight permits no AWS writes',()=>candidate(async(directory,a)=>{const aws=fakeAws();await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{throw Error('unauthorized origin');}}));assert.equal(aws.operations.length,0);}));
test('audit intent failure prevents pointer mutation',()=>candidate(async(directory,a)=>{const aws=fakeAws({intentFail:true});await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{},probe:async()=>({status:'OBSERVED_HEALTHY'})}));assert.equal(aws.operations.filter(o=>o.op==='put-key').length,0);}));
test('ambiguous pointer failure is recorded UNKNOWN and never retried',()=>candidate(async(directory,a)=>{const aws=fakeAws({pointerFail:true});await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{},probe:async()=>({status:'OBSERVED_HEALTHY'})}));assert.equal(aws.operations.filter(o=>o.op==='put-key').length,1);assert.ok(aws.operations.some(o=>o.key?.endsWith('outcome.json')));}));
test('human approval is rechecked before publication',()=>candidate(async(directory,a)=>{const aws=fakeAws();let count=0;await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>++count===1?authorization:{...authorization,approver_id:999},preflight:async()=>{}}));assert.equal(aws.operations.filter(o=>o.op==='put-key').length,0);}));
test('expected artifact pin prevents a changed release',()=>candidate(async(directory)=>{const aws=fakeAws();await assert.rejects(()=>publish({c:config,directory,expectedArtifact:'f'.repeat(64),aws,approvePublication:async()=>{},authorize:async()=>authorization}));assert.equal(aws.operations.length,0);}));
test('health rejects redirect instead of following an arbitrary origin',()=>candidate(async(_directory,a)=>assert.rejects(()=>health(config,a,async()=>({status:302})))));
test('health rejects clinically open endpoints after checking exact content',()=>candidate(async(directory,a)=>{
    const request=async url=>{const name=new URL(url).pathname;const member=a.members.find(m=>ROUTES[name]===m.path);if(!member)return {status:200};return {status:200,headers:{get:key=>HEADERS[key]??null},arrayBuffer:async()=>fs.readFile(path.join(directory,'public',member.path))};};await assert.rejects(()=>health(config,a,request));
}));
test('publication writes immutable content and audit intent before exactly one conditional pointer',()=>candidate(async(directory,a)=>{
    const aws=fakeAws();const result=await publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{},probe:async()=>({status:'OBSERVED_HEALTHY'})});
    assert.equal(result.status,'OBSERVED_HEALTHY');const pointer=aws.operations.findIndex(o=>o.op==='put-key');assert.ok(pointer>aws.operations.findIndex(o=>o.key?.endsWith('intent.json')));
    assert.equal(aws.operations.filter(o=>o.op==='put-key').length,1);assert.equal(aws.operations[pointer].input.IfMatch,'fixture-etag');assert.equal(aws.operations[pointer].input.Key,'activeRelease');
    const outcome=JSON.parse(aws.operations.find(o=>o.key?.endsWith('outcome.json')).body);assert.equal(outcome.status,'OBSERVED_HEALTHY');assert.equal(outcome.source_sha256,a.source_sha256);
}));
test('unavailable health preserves UNKNOWN after pointer mutation',()=>candidate(async(directory,a)=>{
    const aws=fakeAws();await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{},probe:async()=>{throw Error('unavailable');}}));
    assert.equal(JSON.parse(aws.operations.find(o=>o.key?.endsWith('outcome.json')).body).status,'UNKNOWN');assert.equal(aws.operations.filter(o=>o.op==='put-key').length,1);
}));
test('rollback without an earlier healthy receipt performs no write',()=>candidate(async(directory,a)=>{
    const aws=fakeAws();await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,mode:'rollback',priorReceipt:'audit/1-1/outcome.json',aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{}}));assert.equal(aws.operations.length,0);
}));
test('an existing immutable key with different bytes blocks publication',()=>candidate(async(directory,a)=>{
    const aws=fakeAws();aws.put=async()=>{throw Error('precondition');};aws.get=async()=>Buffer.from('foreign payload');
    await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{}}));assert.equal(aws.operations.filter(o=>o.op==='put-key').length,0);
}));
test('a new intent cannot reuse an already audited attempt',()=>candidate(async(directory,a)=>{
    const aws=fakeAws();const original=aws.put;aws.put=async(bucket,key,body,type)=>{if(key.endsWith('/intent.json'))throw Error('already exists');return original(bucket,key,body,type);};
    await assert.rejects(()=>publish({c:config,directory,expectedArtifact:a.artifact_sha256,aws,approvePublication:async()=>{},authorize:async()=>authorization,preflight:async()=>{},probe:async()=>({status:'OBSERVED_HEALTHY'})}));assert.equal(aws.operations.filter(o=>o.op==='put-key').length,0);
}));

// Authored provider responses test mechanics only; no executed human authority is produced.
import { infrastructureAuthorization } from './deploy.mjs';
import { canonical } from './policy.mjs';
import { readSource,sha256 } from './build.mjs';
import { edgeCode } from './edge.mjs';
async function commissionedFixture(change={}){
    const c={...config},source=(await readSource()).sha256;
    const d={Enabled:true,Origins:{Quantity:1,Items:[{Id:'fixed',DomainName:c.content_bucket+'.s3.eu-north-1.amazonaws.com',OriginAccessControlId:'authored-oac',S3OriginConfig:{OriginAccessIdentity:''}}]},
        Aliases:{Quantity:0},CacheBehaviors:{Quantity:0},OriginGroups:{Quantity:0},DefaultCacheBehavior:{TargetOriginId:'fixed',ViewerProtocolPolicy:'https-only',AllowedMethods:{Items:['GET','HEAD']},LambdaFunctionAssociations:{Quantity:0},FunctionAssociations:{Quantity:1,Items:[{EventType:'viewer-request',FunctionARN:c.guard_function_arn}]},ResponseHeadersPolicyId:c.headers_policy_id,CachePolicyId:c.cache_policy_id}};
    const headers={SecurityHeadersConfig:{ContentSecurityPolicy:{ContentSecurityPolicy:HEADERS['content-security-policy'],Override:true}}};
    const cache={MinTTL:0,ParametersInCacheKeyAndForwardedToOrigin:{CookiesConfig:{CookieBehavior:'none'},HeadersConfig:{HeaderBehavior:'none'},QueryStringsConfig:{QueryStringBehavior:'none'}}};
    const bucketPolicy=bucket=>{const arn='arn:aws:s3:::'+bucket;const statements=[{Sid:'DenyInsecureTransport',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[arn,arn+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}},{Sid:'RequireConditionalWrites',Effect:'Deny',Principal:'*',Action:'s3:PutObject',Resource:arn+'/*',Condition:{Null:{'s3:if-none-match':'true'}}}];if(bucket===c.content_bucket)statements.push({Sid:'AllowOnlyThisDistributionRead',Effect:'Allow',Principal:{Service:'cloudfront.amazonaws.com'},Action:'s3:GetObject',Resource:arn+'/releases/*',Condition:{StringEquals:{'AWS:SourceArn':'arn:aws:cloudfront::'+c.project_id+':distribution/'+c.distribution_id}}});return {Version:'2012-10-17',Statement:statements};};
    const records=new Map(),configHash=sha256(canonical(Object.fromEntries(Object.entries(c).filter(([key])=>!key.endsWith('_sha256')))));
    for(const key of ['security_review_record_sha256','bootstrap_record_sha256','content_privacy_approval_sha256']){
        const record={schema:'vetios-nonclinical-commissioning-v1',kind:key,scope:'NONCLINICAL_STATIC_ONLY',config_sha256:configHash,source_sha256:change.source?'f'.repeat(64):source,approver_id:456,expires_at:change.expired?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',status:'APPROVED',
            distribution_config_sha256:sha256(canonical(d)),headers_config_sha256:sha256(canonical(headers)),cache_config_sha256:sha256(canonical(cache)),content_policy_sha256:sha256(canonical(bucketPolicy(c.content_bucket))),audit_policy_sha256:sha256(canonical(bucketPolicy(c.audit_bucket)))};
        const bytes=Buffer.from(canonical(record));c[key]=sha256(bytes);records.set('audit/commissioning/'+c[key]+'.json',bytes);
    }
    if(change.origin)d.Origins.Items[0].DomainName='clinical.example';
    if(change.headers)headers.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy="default-src *";
    const aws={get:async(_bucket,key)=>records.get(key),guard:async()=>Buffer.from(change.guard?'changed':edgeCode()),call:async(service,op,input)=>{
        const value={
            'get-caller-identity':{Account:c.project_id,Arn:'arn:aws:sts::'+c.project_id+':assumed-role/authored/test'},
            'get-public-access-block':{PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:!change.public,RestrictPublicBuckets:true}},
            'get-bucket-versioning':{Status:'Enabled'},'get-bucket-encryption':{ServerSideEncryptionConfiguration:{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]}},
            'get-bucket-ownership-controls':{OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]}},'get-bucket-policy':{Policy:JSON.stringify(bucketPolicy(input?.Bucket))},
            'get-object-lock-configuration':{ObjectLockConfiguration:{ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{Mode:'GOVERNANCE',Days:30}}}},
            'describe-function':{FunctionSummary:{FunctionConfig:{Runtime:'cloudfront-js-2.0',KeyValueStoreAssociations:{Quantity:1,Items:[{KeyValueStoreARN:c.kvs_arn}]}}}},
            'get-distribution':{Distribution:{DomainName:c.domain,Status:'Deployed',DistributionConfig:d}},
            'get-response-headers-policy':{ResponseHeadersPolicy:{ResponseHeadersPolicyConfig:headers}},'get-cache-policy':{CachePolicy:{CachePolicyConfig:cache}},
        };assert.ok(op in value,service+op);return value[op];
    }};
    return {c,aws,artifact:{source_sha256:source}};
}
test('provider readbacks and source-bound commissioning hashes compose',async()=>{const f=await commissionedFixture();assert.equal((await infrastructureAuthorization(f.c,f.aws,f.artifact,authorization)).records.length,3);});
for(const adverse of ['expired','source','origin','guard','headers','public'])test('live preflight rejects '+adverse+' drift',async()=>{const f=await commissionedFixture({[adverse]:true});await assert.rejects(()=>infrastructureAuthorization(f.c,f.aws,f.artifact,authorization));});

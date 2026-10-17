import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { canonical,GOVERNANCE,HEADERS,PARENT_REPOSITORY,PARENT_REPOSITORY_ID,ROUTES,shaPattern } from './policy.mjs';
import { ROOT,readSource,sha256 } from './build.mjs';
import { edgeCode } from './edge.mjs';
import { CONTENT_TYPES } from './serve.mjs';
import { awsClient } from './aws.mjs';
const ENVIRONMENT='vetios-nonclinical-production';
export function validateConfig(c) {
    const fields=['schema','status','project_id','region','repository','repository_id','human_deployer_ids','content_bucket','audit_bucket','kvs_arn','distribution_id','domain','publisher_role_arn','guard_function_arn','headers_policy_id','cache_policy_id','monitoring_owner','security_review_record_sha256','bootstrap_record_sha256','content_privacy_approval_sha256','publication_approval_sha256'];
    assert.equal(canonical(Object.keys(c).sort()),canonical(fields.sort()),'closed configuration required');
    assert.equal(c.schema,'vetios-nonclinical-deployment-v2');assert.equal(c.status,'COMMISSIONED_NONCLINICAL');
    assert.equal(c.project_id,'845081398643');assert.equal(c.region,'eu-north-1');
    assert.match(c.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);assert.notEqual(c.repository.toLowerCase(),PARENT_REPOSITORY.toLowerCase());
    assert.ok(Number.isSafeInteger(c.repository_id)&&c.repository_id>0&&c.repository_id!==PARENT_REPOSITORY_ID);
    assert.ok(c.human_deployer_ids.length>0&&c.human_deployer_ids.every(id=>Number.isSafeInteger(id)&&id>0));
    for(const key of ['content_bucket','audit_bucket'])assert.match(c[key],/^vetios-nonclinical-[a-z0-9-]{3,44}$/);
    assert.notEqual(c.content_bucket,c.audit_bucket);assert.match(c.distribution_id,/^[A-Z0-9]{8,32}$/);
    assert.match(c.domain,/^d[a-z0-9]{5,40}\.cloudfront\.net$/);
    assert.match(c.kvs_arn,/^arn:aws:cloudfront::845081398643:key-value-store\/[a-zA-Z0-9-]+$/);
    assert.match(c.publisher_role_arn,/^arn:aws:iam::845081398643:role\/[A-Za-z0-9-]+$/);
    assert.match(c.guard_function_arn,/^arn:aws:cloudfront::845081398643:function\/[A-Za-z0-9-]+$/);
    for(const key of ['headers_policy_id','cache_policy_id'])assert.match(c[key],/^[a-z0-9-]{10,64}$/);
    assert.ok(typeof c.monitoring_owner==='string'&&c.monitoring_owner.length>2);
    for(const key of ['security_review_record_sha256','bootstrap_record_sha256','content_privacy_approval_sha256'])assert.match(c[key],shaPattern);
    assert.ok(c.publication_approval_sha256===null||shaPattern.test(c.publication_approval_sha256));
    return c;
}
export async function inspectArtifact(directory,{sourceRoot=ROOT,requireCurrentSource=true}={}) {
    const manifest=JSON.parse(await regular(path.join(directory,'artifact.json')));
    assert.deepEqual(Object.keys(manifest).sort(),['schema','source_sha256','members','artifact_sha256','governance','production_authorized'].sort());
    assert.equal(manifest.schema,'vetios-nonclinical-artifact-v1');assert.equal(manifest.production_authorized,false);assert.deepEqual(manifest.governance,GOVERNANCE);
    assert.match(manifest.source_sha256,shaPattern);assert.match(manifest.artifact_sha256,shaPattern);
    assert.equal(sha256(canonical({schema:manifest.schema,source_sha256:manifest.source_sha256,members:manifest.members})),manifest.artifact_sha256);
    const expected=[...new Set(Object.values(ROUTES))].sort();assert.deepEqual(manifest.members.map(m=>m.path).sort(),expected);
    const actual=[];
    async function walk(dir,prefix=''){for(const item of await fs.readdir(dir,{withFileTypes:true})){
        assert.equal(item.isSymbolicLink(),false,'artifact symlink');const name=prefix+item.name;
        if(item.isDirectory())await walk(path.join(dir,item.name),name+'/');else{assert.ok(item.isFile());actual.push(name);}
    }}
    await walk(path.join(directory,'public'));assert.deepEqual(actual.sort(),expected);
    for(const m of manifest.members){assert.deepEqual(Object.keys(m).sort(),['bytes','path','sha256']);const bytes=await regular(path.join(directory,'public',m.path));assert.equal(bytes.length,m.bytes);assert.equal(sha256(bytes),m.sha256);}
    const release=JSON.parse(await regular(path.join(directory,'public/release.json')));
    assert.deepEqual(release,{schema:'vetios-nonclinical-release-v1',source_sha256:manifest.source_sha256,scope:'STATIC_PUBLIC_AND_FIXED_SYNTHETIC_ONLY',patient_data:false,clinical_api:false,autonomous_clinical_actions:false,outcome_learning:false,federation:false,governance:GOVERNANCE});
    if(requireCurrentSource)assert.equal(manifest.source_sha256,(await readSource(sourceRoot)).sha256,'source changed');return manifest;
}
export async function regular(file) {
    const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024,'bounded regular file required');return fs.readFile(file);
}
export async function githubGet(route,token=process.env.GH_READ_TOKEN||process.env.GITHUB_TOKEN) {
    assert.ok(token,'GitHub read access required');assert.match(route,/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/|$)/);
    const r=await fetch('https://api.github.com'+route,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)});
    assert.ok(r.ok,'GitHub security configuration unavailable');const text=await r.text();assert.ok(text.length<1024*1024);return JSON.parse(text);
}
export async function humanAuthorization(c,env=process.env,get=githubGet) {
    validateConfig(c);assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted');
    assert.equal(env.GITHUB_REPOSITORY,c.repository);assert.equal(env.GITHUB_REPOSITORY_ID,String(c.repository_id));
    assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
    assert.match(env.GITHUB_RUN_ID,/^[1-9][0-9]*$/);assert.match(env.GITHUB_RUN_ATTEMPT,/^[1-9][0-9]*$/);assert.match(env.GITHUB_SHA,/^[a-f0-9]{40}$/);
    const base='/repos/'+c.repository;
    const [repo,branch,environment,oidc,run,reviews,protection]=await Promise.all([
        get(base),get(base+'/branches/main'),get(base+'/environments/'+ENVIRONMENT),
        get(base+'/actions/oidc/customization/sub'),get(base+'/actions/runs/'+env.GITHUB_RUN_ID),get(base+'/actions/runs/'+env.GITHUB_RUN_ID+'/approvals'),get(base+'/branches/main/protection')]);
    assert.equal(repo.id,c.repository_id);assert.equal(repo.default_branch,'main');assert.equal(branch.commit.sha,env.GITHUB_SHA);
    assert.equal(run.event,'workflow_dispatch');assert.equal(run.head_sha,env.GITHUB_SHA);assert.equal(run.head_branch,'main');assert.equal(run.run_attempt,Number(env.GITHUB_RUN_ATTEMPT));
    assert.equal(run.path,'.github/workflows/nonclinical.yml');assert.equal(run.repository.id,c.repository_id);
    assert.equal(oidc.use_default,false);assert.deepEqual(oidc.include_claim_keys,['repository_id','context']);
    const required=environment.protection_rules.find(r=>r.type==='required_reviewers');assert.ok(required?.reviewers?.length>0&&required.reviewers.every(r=>r.type==='User'&&c.human_deployer_ids.includes(r.reviewer.id)));
    assert.equal(environment.can_admins_bypass,false);assert.equal(environment.deployment_branch_policy?.custom_branch_policies,true);
    const branches=await get(base+'/environments/'+ENVIRONMENT+'/deployment-branch-policies');assert.equal(branches.branch_policies.length,1);assert.equal(branches.branch_policies[0].name,'main');assert.equal(branches.branch_policies[0].type,'branch');
    assert.equal(protection.enforce_admins?.enabled,true);assert.equal(protection.allow_force_pushes?.enabled,false);assert.equal(protection.allow_deletions?.enabled,false);
    assert.equal(protection.required_status_checks?.strict,true);assert.ok(protection.required_status_checks.contexts.includes('qualify'));
    const review=reviews.find(r=>r.state==='approved'&&r.environments.some(e=>e.name===ENVIRONMENT)&&r.user.type==='User'&&c.human_deployer_ids.includes(r.user.id));assert.ok(review,'actual human environment approval required');
    return {run_id:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,source_commit:env.GITHUB_SHA,approver_id:review.user.id,repository_id:c.repository_id};
}
export async function infrastructureAuthorization(c,aws,artifact,authorization,now=Date.now()) {
    const identity=await aws.call('sts','get-caller-identity');assert.equal(identity.Account,c.project_id);
    assert.ok(identity.Arn.startsWith('arn:aws:sts::'+c.project_id+':assumed-role/'+c.publisher_role_arn.split('/').at(-1)+'/'));
    const records={};
    const configHash=sha256(canonical(Object.fromEntries(Object.entries(c).filter(([key])=>!key.endsWith('_sha256')))));
    for(const key of ['security_review_record_sha256','bootstrap_record_sha256','content_privacy_approval_sha256']){
        const bytes=await aws.get(c.audit_bucket,'audit/commissioning/'+c[key]+'.json');assert.equal(sha256(bytes),c[key]);const record=JSON.parse(bytes);
        assert.equal(record.schema,'vetios-nonclinical-commissioning-v1');assert.equal(record.kind,key);assert.equal(record.scope,'NONCLINICAL_STATIC_ONLY');
        assert.equal(record.config_sha256,configHash);assert.equal(record.source_sha256,artifact.source_sha256);assert.ok(c.human_deployer_ids.includes(record.approver_id));
        assert.ok(Number.isFinite(Date.parse(record.expires_at))&&Date.parse(record.expires_at)>now);assert.equal(record.status,'APPROVED');records[key]=record;
    }
    for(const [kind,bucket]of [['content',c.content_bucket],['audit',c.audit_bucket]]){
        const publicAccess=(await aws.call('s3api','get-public-access-block',{Bucket:bucket,ExpectedBucketOwner:c.project_id})).PublicAccessBlockConfiguration;
        assert.deepEqual(publicAccess,{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true});
        assert.equal((await aws.call('s3api','get-bucket-versioning',{Bucket:bucket,ExpectedBucketOwner:c.project_id})).Status,'Enabled');
        const encryption=(await aws.call('s3api','get-bucket-encryption',{Bucket:bucket,ExpectedBucketOwner:c.project_id})).ServerSideEncryptionConfiguration;
        assert.equal(encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm,'AES256');
        assert.equal((await aws.call('s3api','get-bucket-ownership-controls',{Bucket:bucket,ExpectedBucketOwner:c.project_id})).OwnershipControls.Rules[0].ObjectOwnership,'BucketOwnerEnforced');
        const policy=JSON.parse((await aws.call('s3api','get-bucket-policy',{Bucket:bucket,ExpectedBucketOwner:c.project_id})).Policy);
        const arn='arn:aws:s3:::'+bucket;
        const expected=[{Sid:'DenyInsecureTransport',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[arn,arn+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}},
            {Sid:'RequireConditionalWrites',Effect:'Deny',Principal:'*',Action:'s3:PutObject',Resource:arn+'/*',Condition:{Null:{'s3:if-none-match':'true'}}}];
        if(kind==='content')expected.push({Sid:'AllowOnlyThisDistributionRead',Effect:'Allow',Principal:{Service:'cloudfront.amazonaws.com'},Action:'s3:GetObject',Resource:arn+'/releases/*',Condition:{StringEquals:{'AWS:SourceArn':'arn:aws:cloudfront::'+c.project_id+':distribution/'+c.distribution_id}}});
        assert.equal(policy.Version,'2012-10-17');assert.deepEqual([...policy.Statement].sort((a,b)=>a.Sid.localeCompare(b.Sid)),expected.sort((a,b)=>a.Sid.localeCompare(b.Sid)));
        assert.equal(records.bootstrap_record_sha256[kind+'_policy_sha256'],sha256(canonical(policy)));
    }
    const retention=(await aws.call('s3api','get-object-lock-configuration',{Bucket:c.audit_bucket,ExpectedBucketOwner:c.project_id})).ObjectLockConfiguration;
    assert.equal(retention.ObjectLockEnabled,'Enabled');assert.equal(retention.Rule.DefaultRetention.Mode,'GOVERNANCE');assert.equal(retention.Rule.DefaultRetention.Days,30);
    const distribution=(await aws.call('cloudfront','get-distribution',{Id:c.distribution_id})).Distribution;
    assert.equal(distribution.DomainName,c.domain);assert.equal(distribution.Status,'Deployed');const d=distribution.DistributionConfig;
    assert.equal(d.Enabled,true);assert.equal(d.Origins.Quantity,1);assert.equal(d.Origins.Items[0].DomainName,c.content_bucket+'.s3.eu-north-1.amazonaws.com');
    assert.ok(d.Origins.Items[0].OriginAccessControlId);assert.ok(d.Origins.Items[0].S3OriginConfig);assert.equal(d.Origins.Items[0].CustomOriginConfig,undefined);
    for(const key of ['Aliases','CacheBehaviors','OriginGroups'])assert.equal(d[key]?.Quantity??0,0);
    assert.equal(d.DefaultCacheBehavior.TargetOriginId,d.Origins.Items[0].Id);assert.equal(d.DefaultCacheBehavior.ViewerProtocolPolicy,'https-only');
    assert.deepEqual(d.DefaultCacheBehavior.AllowedMethods.Items.sort(),['GET','HEAD']);assert.equal(d.DefaultCacheBehavior.LambdaFunctionAssociations?.Quantity??0,0);
    assert.equal(d.DefaultCacheBehavior.FunctionAssociations.Quantity,1);assert.deepEqual(d.DefaultCacheBehavior.FunctionAssociations.Items,[{EventType:'viewer-request',FunctionARN:c.guard_function_arn}]);
    assert.equal(d.DefaultCacheBehavior.ResponseHeadersPolicyId,c.headers_policy_id);assert.equal(d.DefaultCacheBehavior.CachePolicyId,c.cache_policy_id);assert.equal(d.DefaultCacheBehavior.OriginRequestPolicyId,undefined);
    const guardConfig=(await aws.call('cloudfront','describe-function',{Name:c.guard_function_arn.split('/').at(-1),Stage:'LIVE'})).FunctionSummary.FunctionConfig;
    assert.equal(guardConfig.Runtime,'cloudfront-js-2.0');assert.equal(guardConfig.KeyValueStoreAssociations.Quantity,1);assert.deepEqual(guardConfig.KeyValueStoreAssociations.Items,[{KeyValueStoreARN:c.kvs_arn}]);
    assert.equal(sha256(await aws.guard(c.guard_function_arn)),sha256(edgeCode()));
    const header=(await aws.call('cloudfront','get-response-headers-policy',{Id:c.headers_policy_id})).ResponseHeadersPolicy.ResponseHeadersPolicyConfig;
    assert.equal(header.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,HEADERS['content-security-policy']);assert.equal(header.SecurityHeadersConfig.ContentSecurityPolicy.Override,true);
    const viewerCache=header.CustomHeadersConfig?.Items?.filter(h=>h.Header.toLowerCase()==='cache-control');
    assert.equal(viewerCache?.length,1,'exactly one viewer cache policy required');assert.equal(viewerCache[0].Value,HEADERS['cache-control']);assert.equal(viewerCache[0].Override,true);
    const cache=(await aws.call('cloudfront','get-cache-policy',{Id:c.cache_policy_id})).CachePolicy.CachePolicyConfig;
    assert.equal(cache.DefaultTTL,0);assert.equal(cache.MinTTL,0);assert.equal(cache.MaxTTL,31536000);const p=cache.ParametersInCacheKeyAndForwardedToOrigin;assert.equal(p.CookiesConfig.CookieBehavior,'none');assert.equal(p.HeadersConfig.HeaderBehavior,'none');assert.equal(p.QueryStringsConfig.QueryStringBehavior,'none');
    // The approved bootstrap record binds every returned infrastructure property, not just selected fields.
    assert.equal(records.bootstrap_record_sha256.distribution_config_sha256,sha256(canonical(d)));
    assert.equal(records.bootstrap_record_sha256.headers_config_sha256,sha256(canonical(header)));assert.equal(records.bootstrap_record_sha256.cache_config_sha256,sha256(canonical(cache)));
    return {authorization,config_sha256:configHash,records:Object.values(records).map(r=>r.kind)};
}
export async function health(c,artifact,request=fetch) {
    const root='https://'+c.domain;
    for(const member of artifact.members){
        const uri=Object.keys(ROUTES).find(uri=>ROUTES[uri]===member.path);const r=await request(root+uri,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);
        for(const [key,value]of Object.entries(HEADERS))assert.equal(r.headers.get(key),value,'security header '+key);
        assert.equal(r.headers.get('set-cookie'),null);const body=Buffer.from(await r.arrayBuffer());assert.equal(body.length,member.bytes);assert.equal(sha256(body),member.sha256);
    }
    for(const [uri,method]of [['/api/inference','POST'],['/api/outcomes','GET'],['/admin','GET'],['/api/federation','POST']]){
        const r=await request(root+uri,{method,redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(r.status,403);
    }
    return {status:'OBSERVED_HEALTHY',artifact_sha256:artifact.artifact_sha256,observed_at:new Date().toISOString()};
}
export async function publicationAuthorization(c,aws,artifact,authorization,mode,now=Date.now()) {
    assert.match(c.publication_approval_sha256??'',shaPattern,'separate written publication approval required');
    const bytes=await aws.get(c.audit_bucket,'audit/authorizations/'+c.publication_approval_sha256+'.json');assert.equal(sha256(bytes),c.publication_approval_sha256);
    const record=JSON.parse(bytes);assert.equal(record.schema,'vetios-nonclinical-publication-approval-v1');assert.equal(record.status,'APPROVED');
    assert.equal(record.scope,'NONCLINICAL_STATIC_ONLY');assert.equal(record.environment,ENVIRONMENT);assert.equal(record.project_id,c.project_id);assert.equal(record.region,c.region);
    assert.equal(record.repository_id,c.repository_id);assert.equal(record.source_commit,authorization.source_commit);assert.equal(record.source_sha256,artifact.source_sha256);assert.equal(record.artifact_sha256,artifact.artifact_sha256);
    assert.equal(record.mode,mode);assert.equal(record.approver_id,authorization.approver_id);assert.ok(c.human_deployer_ids.includes(record.approver_id));
    const core=Object.fromEntries(Object.entries(c).filter(([key])=>!key.endsWith('_sha256')));assert.equal(record.config_sha256,sha256(canonical(core)));
    assert.ok(Number.isFinite(Date.parse(record.issued_at))&&Date.parse(record.issued_at)<=now);assert.ok(Number.isFinite(Date.parse(record.expires_at))&&Date.parse(record.expires_at)>now);
    return record;
}
export async function suspendedHealth(c,_artifact,request=fetch) {
    const root='https://'+c.domain;
    for(const uri of Object.keys(ROUTES)){
        const response=await request(root+uri,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(response.status,503,'suspension must expose no public artifact');
        for(const [key,value]of Object.entries(HEADERS))assert.equal(response.headers.get(key),value);assert.equal(response.headers.get('set-cookie'),null);
    }
    for(const uri of ['/api/inference','/api/outcomes','/api/federation','/admin'])assert.equal((await request(root+uri,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)})).status,403);
    return {status:'OBSERVED_SUSPENDED',observed_at:new Date().toISOString(),public_content_exposed:false};
}
export async function publish({c,directory,expectedArtifact,mode='publish',priorReceipt,aws,authorize,preflight,probe,approvePublication=publicationAuthorization}) {
    validateConfig(c);assert.match(expectedArtifact,shaPattern);assert.ok(['publish','rollback','suspend'].includes(mode));
    const artifact=await inspectArtifact(directory,{requireCurrentSource:mode!=='rollback'});assert.equal(artifact.artifact_sha256,expectedArtifact);
    const authorization=await authorize();await preflight(artifact,authorization);
    if(mode!=='suspend')await approvePublication(c,aws,artifact,authorization,mode);
    if(mode==='rollback'){
        assert.match(priorReceipt,/^audit\/[1-9][0-9]*-[1-9][0-9]*\/outcome\.json$/);
        const prior=JSON.parse(await aws.get(c.audit_bucket,priorReceipt));assert.equal(prior.source_sha256,artifact.source_sha256);assert.equal(prior.status,'OBSERVED_HEALTHY');assert.equal(prior.artifact_sha256,expectedArtifact);assert.equal(prior.repository_id,c.repository_id);
    }
    if(mode!=='suspend')for(const m of [...artifact.members,{path:'artifact.json'}]){
        const body=await regular(m.path==='artifact.json'?path.join(directory,'artifact.json'):path.join(directory,'public',m.path));
        const key='releases/'+expectedArtifact+'/'+m.path;
        try{await aws.put(c.content_bucket,key,body,CONTENT_TYPES[path.extname(m.path)]);}catch(error){
            // No blind retry: an existing immutable object must match byte for byte.
            assert.equal(sha256(await aws.get(c.content_bucket,key)),sha256(body),'immutable object conflict');
        }
    }
    const second=await authorize();assert.deepEqual(second,authorization);await preflight(artifact,authorization);
    if(mode!=='suspend')await approvePublication(c,aws,artifact,authorization,mode);
    assert.equal((await inspectArtifact(directory,{requireCurrentSource:mode!=='rollback'})).artifact_sha256,expectedArtifact);
    const key='audit/'+authorization.run_id+'-'+authorization.attempt;
    const before=await aws.call('cloudfront-keyvaluestore','describe-key-value-store',{KvsARN:c.kvs_arn});
    await aws.put(c.audit_bucket,key+'/intent.json',Buffer.from(canonical({schema:'vetios-nonclinical-intent-v1',mode,...authorization,artifact_sha256:expectedArtifact,previous_etag:before.ETag,publication_approval_sha256:mode==='suspend'?null:c.publication_approval_sha256,governance:GOVERNANCE})));
    let outcome={status:'NOT_ATTEMPTED',pointer_mutation_attempted:false,artifact_sha256:expectedArtifact,source_sha256:artifact.source_sha256,repository_id:c.repository_id,...authorization};
    try {
        if(mode!=='suspend')await approvePublication(c,aws,artifact,authorization,mode);
        outcome={...outcome,status:'UNKNOWN',pointer_mutation_attempted:true};
        // Exactly one conditional mutation. Errors remain UNKNOWN; operators inspect before a new approved attempt.
        await aws.call('cloudfront-keyvaluestore','put-key',{KvsARN:c.kvs_arn,Key:'activeRelease',Value:mode==='suspend'?'SUSPENDED':expectedArtifact,IfMatch:before.ETag});
        outcome={...outcome,...await probe(artifact,mode)};
    }finally{await aws.put(c.audit_bucket,key+'/outcome.json',Buffer.from(canonical(outcome)));}
    return outcome;
}
export async function fetchRollback(c,directory,expectedArtifact,priorReceipt,aws) {
    assert.match(expectedArtifact,shaPattern);assert.match(priorReceipt,/^audit\/[1-9][0-9]*-[1-9][0-9]*\/outcome\.json$/);
    const prior=JSON.parse(await aws.get(c.audit_bucket,priorReceipt));assert.equal(prior.status,'OBSERVED_HEALTHY');assert.equal(prior.artifact_sha256,expectedArtifact);assert.equal(prior.repository_id,c.repository_id);
    const bytes=await aws.get(c.content_bucket,'releases/'+expectedArtifact+'/artifact.json');const manifest=JSON.parse(bytes);
    assert.equal(manifest.artifact_sha256,expectedArtifact);assert.equal(manifest.source_sha256,prior.source_sha256);
    assert.equal(sha256(canonical({schema:manifest.schema,source_sha256:manifest.source_sha256,members:manifest.members})),expectedArtifact);
    assert.deepEqual(manifest.members.map(m=>m.path).sort(),[...new Set(Object.values(ROUTES))].sort());
    await fs.mkdir(directory,{recursive:false});await fs.writeFile(path.join(directory,'artifact.json'),bytes,{flag:'wx',mode:0o600});
    for(const member of manifest.members){const body=await aws.get(c.content_bucket,'releases/'+expectedArtifact+'/'+member.path);assert.equal(sha256(body),member.sha256);const to=path.join(directory,'public',member.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,body,{flag:'wx',mode:0o600});}
    return inspectArtifact(directory,{requireCurrentSource:false});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
    const [verb,configPath,directory,expectedArtifact,priorReceipt]=process.argv.slice(2);
    const c=validateConfig(JSON.parse(await regular(configPath)));
    if(verb==='github-preflight'){await humanAuthorization(c);process.stdout.write('Human authorization verified.\n');}
    else if(verb==='fetch-rollback'){await humanAuthorization(c);await fetchRollback(c,directory,expectedArtifact,priorReceipt,awsClient());}
    else if(verb==='monitor')process.stdout.write(canonical(await health(c,await inspectArtifact(directory)))+'\n');
    else if(['publish','rollback','suspend'].includes(verb)){
        const aws=awsClient();const result=await publish({c,directory,expectedArtifact,mode:verb,priorReceipt,aws,authorize:()=>humanAuthorization(c),preflight:(artifact,authorization)=>infrastructureAuthorization(c,aws,artifact,authorization),probe:(artifact,mode)=>mode==='suspend'?suspendedHealth(c,artifact):health(c,artifact)});process.stdout.write(canonical(result)+'\n');
    }else throw Error('usage: deploy.mjs github-preflight|publish|rollback|suspend|monitor CONFIG [ARTIFACT_DIRECTORY EXPECTED_SHA [PRIOR_HEALTHY_RECEIPT]]');
}

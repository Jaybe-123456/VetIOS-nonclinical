import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT,readSource,sha256 } from './build.mjs';
import { template } from './infrastructure.mjs';
import { exportSource } from './export.mjs';
import { inspectArtifact } from './deploy.mjs';
import { canonical } from './policy.mjs';
import { inspectVercelOutput } from './vercel.mjs';
const args=process.argv.slice(2),staticOnly=args[0]==='--static-only';if(staticOnly)args.shift();
const [rawDirectory,rawArtifactDir]=args;assert.ok(rawDirectory&&rawArtifactDir);const directory=path.resolve(rawDirectory),artifactDir=path.resolve(rawArtifactDir);await fs.mkdir(directory,{recursive:false,mode:0o700});
const source=await readSource(),artifact=await inspectArtifact(artifactDir);
async function run(name,executable,args,{fails=false}={}) {
    assert.ok(executable,'validator executable required: '+name);const file=path.join(directory,name+'.log');const handle=await fs.open(file,'wx',0o600);let r;
    try{r=spawnSync(executable,args,{cwd:directory,stdio:['ignore',handle.fd,handle.fd],timeout:120000});}finally{await handle.close();}
    assert.equal(r.error,undefined,name+' execution failure');if(fails)assert.ok(r.status!==0,name+' adverse case must fail');else assert.equal(r.status,0,name+' failed; inspect '+file);
    const log=await fs.readFile(file);return {exit_code:r.status,sha256:sha256(log),log:name+'.log'};
}
const checks={};
if(!staticOnly){
checks.lint_version=await run('lint-version',process.env.CFN_LINT,['--version']);assert.match(await fs.readFile(path.join(directory,'lint-version.log'),'utf8'),/1\.57\.2/);
checks.guard_version=await run('guard-version',process.env.CFN_GUARD,['--version']);assert.match(await fs.readFile(path.join(directory,'guard-version.log'),'utf8'),/3\.2\.1/);
checks.scanner_version=await run('scanner-version',process.env.GITLEAKS,['version']);assert.equal((await fs.readFile(path.join(directory,'scanner-version.log'),'utf8')).trim(),'8.24.3');
const stack=path.join(directory,'stack.json');await fs.writeFile(stack,JSON.stringify(template(),null,2)+'\n',{flag:'wx'});
checks.lint=await run('cfn-lint',process.env.CFN_LINT,['--template',stack]);
checks.guard=await run('cfn-guard',process.env.CFN_GUARD,['validate','--rules',path.join(ROOT,'security.guard'),'--data',stack,'--show-summary','all']);
const guard=await fs.readFile(path.join(directory,'cfn-guard.log'),'utf8');assert.match(guard,/PASS/);assert.doesNotMatch(guard,/FAIL/);
const adverse=template();adverse.Resources.Content.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy=false;
const badStack=path.join(directory,'adverse-public-bucket.json');await fs.writeFile(badStack,JSON.stringify(adverse));
checks.guard_adverse=await run('guard-adverse',process.env.CFN_GUARD,['validate','--rules',path.join(ROOT,'security.guard'),'--data',badStack,'--show-summary','all'],{fails:true});assert.match(await fs.readFile(path.join(directory,'guard-adverse.log'),'utf8'),/FAIL/);
for(const [name,mutate]of [
    ['retention-mode',t=>{t.Resources.Audit.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Mode='COMPLIANCE';}],
    ['retention-bypass',t=>{t.Resources.PublisherBoundary.Properties.PolicyDocument.Statement=t.Resources.PublisherBoundary.Properties.PolicyDocument.Statement.filter(s=>s.Sid!=='DenyEvidenceDestruction');}],
    ['viewer-cache-missing',t=>{delete t.Resources.Headers.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig;}],
    ['viewer-cache-override',t=>{t.Resources.Headers.Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items[0].Override=false;}],
    ['minimum-cache-ttl',t=>{t.Resources.Cache.Properties.CachePolicyConfig.MinTTL=60;}]
]){const changed=template();mutate(changed);const file=path.join(directory,'adverse-'+name+'.json');await fs.writeFile(file,JSON.stringify(changed));checks['guard_'+name]=await run('guard-'+name,process.env.CFN_GUARD,['validate','--rules',path.join(ROOT,'security.guard'),'--data',file,'--show-summary','all'],{fails:true});}
const fresh=path.join(directory,'source-export');await exportSource(fresh);
}
const fresh=path.join(directory,'scan-source');await exportSource(fresh);
const scanner=process.env.GITLEAKS;assert.ok(scanner);
assert.equal((spawnSync(scanner,['version'],{encoding:'utf8'}).stdout??'').trim(),'8.24.3');
const config=path.join(directory,'trusted-defaults.toml'),ignore=path.join(directory,'empty-ignore');
await fs.writeFile(config,'[extend]\nuseDefault = true\n',{flag:'wx',mode:0o600});
await fs.writeFile(ignore,'',{flag:'wx',mode:0o600});
const scanArgs=(target,report)=>['dir',target,'--config',config,'--gitleaks-ignore-path',ignore,'--ignore-gitleaks-allow','--no-banner','--redact=100','--report-format','json','--report-path',report,'--exit-code','2'];
// Generated canary exercises the actual pinned binary. It is never a provider credential.
const adverseDir=path.join(directory,'scanner-adverse');await fs.mkdir(adverseDir);
const canary='ghp_'+(await import('node:crypto')).randomBytes(18).toString('hex');
await fs.writeFile(path.join(adverseDir,'candidate.txt'),'token='+canary+' # gitleaks:allow\n',{mode:0o600});
await fs.writeFile(path.join(adverseDir,'.gitleaks.toml'),'[allowlist]\npaths = [".*"]\n',{mode:0o600});
const adverseReport=path.join(directory,'scanner-adverse.json');
checks.scanner_suppression_denied=await run('scanner-adverse',scanner,scanArgs(adverseDir,adverseReport),{fails:true});
assert.equal(checks.scanner_suppression_denied.exit_code,2);
assert.ok(JSON.parse(await fs.readFile(adverseReport,'utf8')).some(row=>row.RuleID==='github-pat'));
await fs.rm(adverseDir,{recursive:true});
for(const [name,target]of [['source',fresh],['public',path.join(artifactDir,'public')]]){
    const report=path.join(directory,'gitleaks-'+name+'.json');checks['gitleaks_'+name]=await run('gitleaks-'+name,scanner,scanArgs(target,report));assert.deepEqual(JSON.parse(await fs.readFile(report,'utf8')),[]);
}
const outputRoot=path.join(path.dirname(artifactDir),'vercel','.vercel','output');
const vercel=await inspectVercelOutput({outputRoot,artifactDirectory:artifactDir,verificationDirectory:path.dirname(artifactDir)});
const outputReport=path.join(directory,'gitleaks-vercel.json');checks.gitleaks_vercel=await run('gitleaks-vercel',scanner,scanArgs(outputRoot,outputReport));assert.deepEqual(JSON.parse(await fs.readFile(outputReport,'utf8')),[]);
checks.audit=await run('npm-audit','npm',['--prefix',ROOT,'audit','--json','--audit-level=low']);const audit=JSON.parse(await fs.readFile(path.join(directory,'npm-audit.log'),'utf8'));assert.equal(audit.metadata.vulnerabilities.total,0);
assert.equal((await readSource()).sha256,source.sha256);
const result={status:'PASS',source_sha256:source.sha256,artifact_sha256:artifact.artifact_sha256,checks,
    profile:staticOnly?'VERCEL_STATIC':'STATIC_AND_AWS_TEMPLATE',vercel_output_sha256:vercel.vercel_output_sha256,
    ...(staticOnly?{}:{template_sha256:sha256(await fs.readFile(path.join(directory,'stack.json'))),guard_rules_sha256:sha256(await fs.readFile(path.join(ROOT,'security.guard')))}),
    runtime_dependencies:0,clinical_history_findings_closed:false,aws_policy_evaluation:'NOT_EXECUTED',deployment_authorized:false};
await fs.writeFile(path.join(directory,'security.json'),canonical(result)+'\n',{flag:'wx'});process.stdout.write(canonical(result)+'\n');

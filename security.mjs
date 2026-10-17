import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT,readSource,sha256 } from './build.mjs';
import { template } from './infrastructure.mjs';
import { exportSource } from './export.mjs';
import { inspectArtifact } from './deploy.mjs';
import { canonical } from './policy.mjs';
const [rawDirectory,rawArtifactDir]=process.argv.slice(2);assert.ok(rawDirectory&&rawArtifactDir);const directory=path.resolve(rawDirectory),artifactDir=path.resolve(rawArtifactDir);await fs.mkdir(directory,{recursive:false});
const source=await readSource(),artifact=await inspectArtifact(artifactDir);
async function run(name,executable,args,{fails=false}={}) {
    assert.ok(executable,'validator executable required: '+name);const file=path.join(directory,name+'.log');const handle=await fs.open(file,'wx',0o600);let r;
    try{r=spawnSync(executable,args,{cwd:ROOT,stdio:['ignore',handle.fd,handle.fd],timeout:120000});}finally{await handle.close();}
    assert.equal(r.error,undefined,name+' execution failure');if(fails)assert.ok(r.status!==0,name+' adverse case must fail');else assert.equal(r.status,0,name+' failed; inspect '+file);
    const log=await fs.readFile(file);return {exit_code:r.status,sha256:sha256(log),log:name+'.log'};
}
const checks={};
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
    ['retention-bypass',t=>{t.Resources.PublisherBoundary.Properties.PolicyDocument.Statement=t.Resources.PublisherBoundary.Properties.PolicyDocument.Statement.filter(s=>s.Sid!=='DenyEvidenceDestruction');}]
]){const changed=template();mutate(changed);const file=path.join(directory,'adverse-'+name+'.json');await fs.writeFile(file,JSON.stringify(changed));checks['guard_'+name]=await run('guard-'+name,process.env.CFN_GUARD,['validate','--rules',path.join(ROOT,'security.guard'),'--data',file,'--show-summary','all'],{fails:true});}
const fresh=path.join(directory,'source-export');await exportSource(fresh);
for(const [name,target]of [['source',fresh],['public',path.join(artifactDir,'public')]]){
    const report=path.join(directory,'gitleaks-'+name+'.json');checks['gitleaks_'+name]=await run('gitleaks-'+name,process.env.GITLEAKS,['dir',target,'--no-banner','--redact','--report-format','json','--report-path',report]);assert.deepEqual(JSON.parse(await fs.readFile(report,'utf8')),[]);
}
checks.audit=await run('npm-audit','npm',['audit','--json','--audit-level=low']);const audit=JSON.parse(await fs.readFile(path.join(directory,'npm-audit.log'),'utf8'));assert.equal(audit.metadata.vulnerabilities.total,0);
assert.equal((await readSource()).sha256,source.sha256);
const result={status:'PASS',source_sha256:source.sha256,artifact_sha256:artifact.artifact_sha256,checks,
    template_sha256:sha256(await fs.readFile(stack)),guard_rules_sha256:sha256(await fs.readFile(path.join(ROOT,'security.guard'))),
    runtime_dependencies:0,clinical_history_findings_closed:false,aws_policy_evaluation:'NOT_EXECUTED',deployment_authorized:false};
await fs.writeFile(path.join(directory,'security.json'),canonical(result)+'\n',{flag:'wx'});process.stdout.write(canonical(result)+'\n');

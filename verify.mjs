import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ROOT,build,readSource,sha256 } from './build.mjs';
import { inspectArtifact } from './deploy.mjs';
import { browserCheck } from './browser.mjs';
import { canonical,GOVERNANCE } from './policy.mjs';
export async function verify(output) {
    const source=await readSource();await fs.mkdir(output,{recursive:false,mode:0o700});
    const log=await fs.open(path.join(output,'contracts.tap'),'wx',0o600);let result;
    try{result=spawnSync(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','verify.test.mjs','deploy.test.mjs','commissioning.test.mjs'],{cwd:ROOT,stdio:['ignore',log.fd,log.fd],timeout:120000});}finally{await log.close();}
    const tap=await fs.readFile(path.join(output,'contracts.tap'),'utf8');
    const tests=Number(tap.match(/^# tests (\d+)$/m)?.[1]),passed=Number(tap.match(/^# pass (\d+)$/m)?.[1]);
    assert.equal(result.status,0,'inspect contracts.tap');assert.ok(tests>=145&&passed===tests,'complete executed negative checks required');assert.match(tap,/^# fail 0$/m);assert.match(tap,/^# skipped 0$/m);
    const directory=path.join(output,'candidate');const artifact=await build(directory);await inspectArtifact(directory);
    // Build twice from the same closed source; compare the actual content digest.
    const repeat=await build(path.join(output,'repeat'));assert.equal(repeat.artifact_sha256,artifact.artifact_sha256);
    const browser=await browserCheck(directory,artifact,output);
    assert.equal((await readSource()).sha256,source.sha256,'source changed during verification');
    const captures=[];for(const file of browser.captures)captures.push({path:file,sha256:sha256(await fs.readFile(path.join(output,file)))});
    const receipt={schema:'vetios-nonclinical-verification-v1',status:'PASS',release_state:'CANDIDATE_PREPARED_NOT_AUTHORIZED',source_sha256:source.sha256,
        artifact_sha256:artifact.artifact_sha256,tests,passed,failed:0,skipped:0,browser,artifact_manifest:artifact,captures,
        tests_sha256:sha256(tap),governance:GOVERNANCE,production_authorized:false,production_actions:0,
        checks:['closed_source_export','artifact_allowlist_and_hashes','deterministic_build','executed_adverse_contracts','desktop_and_mobile_browser','no_clinical_backend','no_external_browser_requests']};
    receipt.receipt_sha256=sha256(canonical(receipt));await fs.writeFile(path.join(output,'nonclinical-verification.json'),canonical(receipt)+'\n',{flag:'wx',mode:0o600});return receipt;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
    const output=process.argv[2]??path.join(ROOT,'evidence','run-'+Date.now());await fs.mkdir(path.dirname(output),{recursive:true});
    process.stdout.write(canonical(await verify(output))+'\n');
}

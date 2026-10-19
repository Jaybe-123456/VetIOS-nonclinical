// Read-only HTTPS monitoring. Missing commissioning evidence remains a failing state.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { canonical,GOVERNANCE,ROUTES,shaPattern } from './policy.mjs';
import { sha256 } from './build.mjs';
import { health } from './deploy.mjs';

export async function monitor({env=process.env,probe=health}={}) {
    const missing=[];
    if(!env.NONCLINICAL_MONITOR_MANIFEST?.trim())missing.push('monitor_manifest_missing');
    if(!env.NONCLINICAL_MONITOR_DOMAIN?.trim())missing.push('monitor_domain_missing');
    const blocked=(status,reasons)=>({schema:'vetios-nonclinical-monitor-v1',status,healthy:false,
        production_authorized:false,reasons});
    if(missing.length)return blocked('NOT_COMMISSIONED',missing);
    let manifest;
    try {
        manifest=JSON.parse(env.NONCLINICAL_MONITOR_MANIFEST);
        assert.equal(manifest.schema,'vetios-nonclinical-artifact-v1');
        assert.equal(manifest.production_authorized,false);assert.deepEqual(manifest.governance,GOVERNANCE);
        assert.match(manifest.source_sha256,shaPattern);assert.match(manifest.artifact_sha256,shaPattern);
        assert.ok(Array.isArray(manifest.members));
        assert.deepEqual(manifest.members.map(m=>m.path).sort(),[...new Set(Object.values(ROUTES))].sort());
        for(const member of manifest.members){assert.match(member.sha256,shaPattern);assert.ok(Number.isSafeInteger(member.bytes)&&member.bytes>0);}
        assert.equal(sha256(canonical({schema:manifest.schema,source_sha256:manifest.source_sha256,members:manifest.members})),manifest.artifact_sha256);
        assert.match(env.NONCLINICAL_MONITOR_DOMAIN,/^d[a-z0-9]{5,40}\.cloudfront\.net$/);
    } catch {return blocked('CONFIGURATION_ERROR',['monitor_configuration_invalid']);}
    try {
        const result=await probe({domain:env.NONCLINICAL_MONITOR_DOMAIN},manifest);
        assert.equal(result.status,'OBSERVED_HEALTHY');
        return {...result,schema:'vetios-nonclinical-monitor-v1',healthy:true,production_authorized:false};
    } catch {return blocked('UNHEALTHY',['public_health_probe_failed']);}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
    const result=await monitor();process.stdout.write(canonical(result)+'\n');
    process.exitCode=result.healthy?0:2;
}

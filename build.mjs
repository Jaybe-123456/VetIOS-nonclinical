import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical, GOVERNANCE, ROUTES } from './policy.mjs';
import { pages } from './content.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const SOURCE_FILES = ['AGENTS.md','.gitignore','package.json','package-lock.json','README.md','policy.mjs','content.mjs','edge.mjs',
    'build.mjs','verify.mjs','verify.test.mjs','commissioning.test.mjs','browser.mjs','serve.mjs','export.mjs','deploy.mjs','deploy.test.mjs','aws.mjs','infrastructure.mjs',
    'deployment.example.json','security.guard','security.mjs','monitor.mjs','monitor.test.mjs','.github/workflows/nonclinical.yml','.github/workflows/monitor.yml',
    'site/assets/site.css','site/assets/demo.js'];
export async function readSource(root = ROOT) {
    const allowed=new Set(SOURCE_FILES);
    async function walk(dir,prefix='') {
        for(const item of await fs.readdir(dir,{withFileTypes:true})){
            const name=prefix+item.name;
            if(!prefix&&['.git','node_modules','build','evidence'].includes(item.name))continue;
            if(item.isSymbolicLink())throw Error('nonclinical_source_symlink:'+name);
            if(item.isDirectory())await walk(path.join(dir,item.name),name+'/');
            else if(!item.isFile()||!allowed.has(name))throw Error('nonclinical_unlisted_source:'+name);
        }
    }
    await walk(root);
    const entries=[];
    for (const name of SOURCE_FILES) {
        const file=path.join(root,name),stat=await fs.lstat(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw Error('nonclinical_source_invalid:'+name);
        const bytes=await fs.readFile(file);
        if(name.endsWith('.mjs'))for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){
            const dep=match[1];
            if(!dep.startsWith('node:')&&dep!=='playwright'&&!(name==='edge.mjs'&&dep==='cloudfront')&&(!dep.startsWith('./')||!allowed.has(dep.slice(2))))throw Error('nonclinical_import_outside_boundary:'+name);
        }
        entries.push({path:name,sha256:sha256(bytes),bytes:bytes.length});
    }
    return {schema:'vetios-nonclinical-source-v1',files:entries,sha256:sha256(canonical(entries))};
}
export async function build(output) {
    const root=ROOT;
    output=path.resolve(output);
    if(output===root||!path.basename(output).match(/^[a-zA-Z0-9._-]+$/))throw Error('nonclinical_output_invalid');
    await fs.mkdir(output,{recursive:false,mode:0o700});
    const source=await readSource(root), publicDir=path.join(output,'public');await fs.mkdir(publicDir,{mode:0o700});
    const files=new Map(Object.entries(pages).map(([name,text])=>[name,Buffer.from(text)]));
    for(const name of ['assets/site.css','assets/demo.js'])files.set(name,await fs.readFile(path.join(root,'site',name)));
    files.set('release.json',Buffer.from(canonical({schema:'vetios-nonclinical-release-v1',source_sha256:source.sha256,
        scope:'STATIC_PUBLIC_AND_FIXED_SYNTHETIC_ONLY',patient_data:false,clinical_api:false,autonomous_clinical_actions:false,
        outcome_learning:false,federation:false,governance:GOVERNANCE})+'\n'));
    const expected=[...new Set(Object.values(ROUTES))].sort();
    if(canonical([...files.keys()].sort())!==canonical(expected))throw Error('nonclinical_public_allowlist_mismatch');
    const members=[];
    for(const [name,bytes] of [...files].sort(([a],[b])=>a.localeCompare(b))){
        const destination=path.join(publicDir,name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
        await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});members.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});
    }
    const artifact={schema:'vetios-nonclinical-artifact-v1',source_sha256:source.sha256,members};
    const result={...artifact,artifact_sha256:sha256(canonical(artifact)),governance:GOVERNANCE,production_authorized:false};
    await fs.writeFile(path.join(output,'artifact.json'),canonical(result)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
    if(process.argv.length!==3)throw Error('usage: node build.mjs NEW_OUTPUT_DIRECTORY');
    process.stdout.write(JSON.stringify(await build(process.argv[2]),null,2)+'\n');
}

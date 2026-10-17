// Export only the audited standalone source, without parent history or credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT,readSource,SOURCE_FILES } from './build.mjs';
import { canonical } from './policy.mjs';
export async function exportSource(destination,{root=ROOT}={}) {
    const source=await readSource(root);await fs.mkdir(destination,{recursive:false,mode:0o700});
    for(const name of SOURCE_FILES){const to=path.join(destination,name);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(root,name),to,fs.constants.COPYFILE_EXCL);}
    const after=await readSource(destination);if(canonical(after)!==canonical(source))throw Error('export_source_changed');return after;
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(canonical(await exportSource(process.argv[2]))+'\n');

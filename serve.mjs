// Qualification server only. The production artifact is static; no Node server is deployed.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { edgeCode } from './edge.mjs';
import { HEADERS } from './policy.mjs';
export const CONTENT_TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
export function edgeHandler(pointer) {
    const context=vm.createContext({cf:{kvs:()=>({get:async()=>{const value=typeof pointer==='function'?pointer():pointer;if(value===null||value===undefined)throw Error('missing');return value;}})}});
    vm.runInContext(edgeCode().slice(edgeCode().indexOf('\n')+1),context,{timeout:1000});
    return request=>context.handler({request});
}
export async function startServer(directory,artifact,{pointer=artifact.artifact_sha256}={}) {
    const guard=edgeHandler(pointer);
    const server=http.createServer(async(req,res)=>{
        try {
            const parsed=new URL(req.url,'http://127.0.0.1');
            const result=await guard({method:req.method,uri:parsed.pathname,headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,{value:String(v)}])),querystring:{},cookies:{}});
            if(result.statusCode){res.writeHead(result.statusCode,Object.fromEntries(Object.entries(result.headers).map(([k,v])=>[k,v.value])));res.end();return;}
            const name=result.uri.slice(('/releases/'+artifact.artifact_sha256+'/').length);
            const member=artifact.members.find(m=>m.path===name);if(!member)throw Error('not_in_manifest');
            const file=path.join(directory,'public',name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('not_regular');
            const body=await fs.readFile(file);res.writeHead(200,{...HEADERS,'content-type':CONTENT_TYPES[path.extname(name)],'cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
        }catch {res.writeHead(500,{...HEADERS,'cache-control':'no-store'});res.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

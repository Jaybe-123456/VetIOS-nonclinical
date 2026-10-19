// Deployment tooling only; never included in the public artifact. No shell evaluation.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROUTES, HEADERS, RELEASE_ORIGIN_CACHE_CONTROL } from './policy.mjs';
const releaseMembers = new Set([...Object.values(ROUTES), 'artifact.json']);
function cacheControl(key) {
    const match = /^releases\/[a-f0-9]{64}\/(.+)$/.exec(key);
    return match && releaseMembers.has(match[1]) ? RELEASE_ORIGIN_CACHE_CONTROL : HEADERS['cache-control'];
}
export function awsClient({run=spawnSync}={}) {
    const call = async (service,operation,input={},binary=false)=>{
        if(!['s3api','cloudfront','cloudfront-keyvaluestore','sts'].includes(service))throw Error('aws_service_outside_scope');
        const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vetios-static-aws-'));
        try {
            const args=[service,operation,'--region',['s3api','sts'].includes(service)?'eu-north-1':'us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','10','--cli-read-timeout','20'];
            const json={...input};
            if(Buffer.isBuffer(json.Body)){await fs.writeFile(path.join(dir,'body'),json.Body,{mode:0o600});delete json.Body;args.push('--body',path.join(dir,'body'));}
            args.push('--cli-input-json',JSON.stringify(json));if(binary)args.push(path.join(dir,'result'));
            const result=run('aws',args,{encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
                env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_STS_REGIONAL_ENDPOINTS:'regional'}});
            if(result.status!==0)throw Error('aws_operation_failed:'+service+':'+operation);
            return binary?await fs.readFile(path.join(dir,'result')):JSON.parse(result.stdout);
        }finally{await fs.rm(dir,{recursive:true,force:true});}
    };
    return {call,
        get:(bucket,key)=>call('s3api','get-object',{Bucket:bucket,Key:key,ExpectedBucketOwner:'845081398643'},true),
        put:(bucket,key,body,type='application/json')=>call('s3api','put-object',{Bucket:bucket,Key:key,ExpectedBucketOwner:'845081398643',Body:body,ContentType:type,CacheControl:cacheControl(key),IfNoneMatch:'*',ServerSideEncryption:'AES256'}),
        guard:arn=>call('cloudfront','get-function',{Name:arn.split('/').at(-1),Stage:'LIVE'},true)};
}

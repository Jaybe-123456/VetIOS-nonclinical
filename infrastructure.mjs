import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CSP, HEADERS } from './policy.mjs';
import { edgeCode } from './edge.mjs';
const ref = name => ({Ref:name}), attr = (name,key) => ({'Fn::GetAtt':[name,key]}), sub = value => ({'Fn::Sub':value});
const context = (why,must) => ({'com.aws.cloudformation.Context':{why,must}});
export function template() {
    const resources={};
    const resource=(name,type,properties,why,must,retain=false)=>resources[name]={Type:type,Properties:properties,Metadata:context(why,must),
        ...(retain?{DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain'}:{})};
    const bucket={BucketEncryption:{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]},
        PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},
        OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]},VersioningConfiguration:{Status:'Enabled'},
        Tags:[{Key:'VetIOSScope',Value:'nonclinical-static-only'}]};
    resource('Content','AWS::S3::Bucket',{...bucket,BucketName:sub('vetios-nonclinical-${AWS::AccountId}-${AWS::StackName}-content')},'Dedicated static content; no website endpoint or clinical data.', ['Private OAC read only','No public ACLs or clinical imports'],true);
    resource('Audit','AWS::S3::Bucket',{...bucket,BucketName:sub('vetios-nonclinical-${AWS::AccountId}-${AWS::StackName}-audit'),ObjectLockEnabled:true,ObjectLockConfiguration:{ObjectLockEnabled:'Enabled',Rule:{DefaultRetention:{Mode:'GOVERNANCE',Days:30}}}},
        'Append-only non-clinical publication evidence; 30-day GOVERNANCE retention; privileged bypass requires separate human authorization.', ['No patient payloads','Publisher cannot delete or bypass retention'],true);
    resource('Pointer','AWS::CloudFront::KeyValueStore',{Name:sub('${AWS::StackName}-nonclinical-pointer'),Comment:'Only activeRelease: a validated static artifact SHA-256'},
        'Change content without giving the publisher distribution/function configuration rights.', ['Only a digest is interpreted','Missing or malformed pointer fails closed'],true);
    resource('RequestGuard','AWS::CloudFront::Function',{Name:sub('${AWS::StackName}-nonclinical-guard'),AutoPublish:true,FunctionCode:edgeCode(),
        FunctionConfig:{Comment:'Static allowlist; no clinical routes, methods, credentials or proxy targets',Runtime:'cloudfront-js-2.0',KeyValueStoreAssociations:[{KeyValueStoreARN:attr('Pointer','Arn')}] }},
        'Server-side allowlist precedes origin access and permits no arbitrary API fallback.', ['Exact static GET/HEAD routes only','No origin selected by a viewer or release pointer']);
    resource('OriginAccess','AWS::CloudFront::OriginAccessControl',{OriginAccessControlConfig:{Name:sub('${AWS::StackName}-nonclinical-oac'),OriginAccessControlOriginType:'s3',SigningBehavior:'always',SigningProtocol:'sigv4'}},
        'CloudFront signs requests to this private REST origin.', ['Never enable a public S3 website origin']);
    resource('Headers','AWS::CloudFront::ResponseHeadersPolicy',{ResponseHeadersPolicyConfig:{Name:sub('${AWS::StackName}-nonclinical-headers'),
        SecurityHeadersConfig:{ContentSecurityPolicy:{ContentSecurityPolicy:CSP,Override:true},ContentTypeOptions:{Override:true},FrameOptions:{FrameOption:'DENY',Override:true},
            ReferrerPolicy:{ReferrerPolicy:'no-referrer',Override:true},StrictTransportSecurity:{AccessControlMaxAgeSec:31536000,Override:true}},
        CustomHeadersConfig:{Items:Object.entries(HEADERS).filter(([key])=>['cache-control','permissions-policy','cross-origin-resource-policy','cross-origin-opener-policy'].includes(key)).map(([Header,Value])=>({Header,Value,Override:true}))}}},
        'Viewer responses stay no-store while digest-prefixed origin objects can be cached independently.', ['No browser reuse across pointer changes','No outbound connections, forms, framing or browser sensors']);
    resource('Cache','AWS::CloudFront::CachePolicy',{CachePolicyConfig:{Name:sub('${AWS::StackName}-nonclinical-cache'),DefaultTTL:0,MinTTL:0,MaxTTL:31536000,
        ParametersInCacheKeyAndForwardedToOrigin:{EnableAcceptEncodingGzip:true,EnableAcceptEncodingBrotli:true,CookiesConfig:{CookieBehavior:'none'},HeadersConfig:{HeaderBehavior:'none'},QueryStringsConfig:{QueryStringBehavior:'none'}}}},
        'Digest-prefixed immutable paths isolate versions; no cookies/query/authorization reach S3.', ['Do not forward clinical sessions']);
    resource('Distribution','AWS::CloudFront::Distribution',{DistributionConfig:{Enabled:true,Comment:'Isolated VetIOS non-clinical public static site',HttpVersion:'http2and3',IPV6Enabled:true,PriceClass:'PriceClass_100',
        Origins:[{Id:'nonclinical-static',DomainName:attr('Content','RegionalDomainName'),S3OriginConfig:{OriginAccessIdentity:''},OriginAccessControlId:ref('OriginAccess')}],
        DefaultCacheBehavior:{TargetOriginId:'nonclinical-static',ViewerProtocolPolicy:'https-only',AllowedMethods:['GET','HEAD'],CachedMethods:['GET','HEAD'],Compress:true,
            CachePolicyId:ref('Cache'),ResponseHeadersPolicyId:ref('Headers'),FunctionAssociations:[{EventType:'viewer-request',FunctionARN:attr('RequestGuard','FunctionARN')}]},
        ViewerCertificate:{CloudFrontDefaultCertificate:true}}},
        'A fresh hostname and one fixed private S3 origin; no clinical DNS or origins.', ['No alternate origins, behaviors, Lambda or API services','Empty pointer serves no published release']);
    for(const name of ['Content','Audit']){
        const arn=attr(name,'Arn');
        resource(name+'Policy','AWS::S3::BucketPolicy',{Bucket:ref(name),PolicyDocument:{Version:'2012-10-17',Statement:[
            {Sid:'DenyInsecureTransport',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[arn,sub('${'+name+'.Arn}/*')],Condition:{Bool:{'aws:SecureTransport':'false'}}},
            {Sid:'RequireConditionalWrites',Effect:'Deny',Principal:'*',Action:'s3:PutObject',Resource:sub('${'+name+'.Arn}/*'),Condition:{Null:{'s3:if-none-match':'true'}}},
            ...(name==='Content'?[{Sid:'AllowOnlyThisDistributionRead',Effect:'Allow',Principal:{Service:'cloudfront.amazonaws.com'},Action:'s3:GetObject',Resource:sub('${Content.Arn}/releases/*'),
                Condition:{StringEquals:{'AWS:SourceArn':sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}')}}}]:[])
        ]}},'Private resource policy; TLS and conditional append-only writes.', ['No anonymous access','No unconditional overwrites']);
    }
    resource('GitHubIdentity','AWS::IAM::OIDCProvider',{Url:'https://token.actions.githubusercontent.com',ClientIdList:['sts.amazonaws.com']},
        'New GitHub OIDC provider only after the bootstrap preflight proves none exists.', ['No long-lived deployment token','Existing provider requires a reviewed template adjustment']);
    const statements=[
        {Sid:'DenyEvidenceDestruction',Effect:'Deny',Action:['s3:BypassGovernanceRetention','s3:PutObjectRetention','s3:PutObjectLegalHold','s3:DeleteObject','s3:DeleteObjectVersion'],Resource:[sub('${Audit.Arn}/*'),sub('${Content.Arn}/*')]},
        {Sid:'ReadDedicatedBucketControls',Effect:'Allow',Action:['s3:GetBucketPublicAccessBlock','s3:GetEncryptionConfiguration','s3:GetBucketVersioning','s3:GetBucketPolicy','s3:GetBucketOwnershipControls'],Resource:[attr('Content','Arn'),attr('Audit','Arn')]},
        {Sid:'ReadDedicatedAuditRetention',Effect:'Allow',Action:['s3:GetBucketObjectLockConfiguration'],Resource:attr('Audit','Arn')},
        {Sid:'StaticReleasesOnly',Effect:'Allow',Action:['s3:GetObject','s3:PutObject'],Resource:sub('${Content.Arn}/releases/*')},
        {Sid:'AppendAuditOnly',Effect:'Allow',Action:['s3:GetObject','s3:PutObject'],Resource:sub('${Audit.Arn}/audit/*')},
        {Sid:'OnePointerOnly',Effect:'Allow',Action:['cloudfront-keyvaluestore:DescribeKeyValueStore','cloudfront-keyvaluestore:GetKey','cloudfront-keyvaluestore:PutKey'],Resource:attr('Pointer','Arn')},
        {Sid:'ReadDedicatedDeliveryConfiguration',Effect:'Allow',Action:['cloudfront:GetDistribution'],Resource:sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}')},
        {Sid:'ReadDedicatedGuard',Effect:'Allow',Action:['cloudfront:GetFunction','cloudfront:DescribeFunction'],Resource:attr('RequestGuard','FunctionARN')},
        {Sid:'ReadDedicatedHeaders',Effect:'Allow',Action:['cloudfront:GetResponseHeadersPolicy'],Resource:sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:response-headers-policy/${Headers}')},
        {Sid:'ReadDedicatedCache',Effect:'Allow',Action:['cloudfront:GetCachePolicy'],Resource:sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:cache-policy/${Cache}')},
    ];
    resource('PublisherBoundary','AWS::IAM::ManagedPolicy',{Description:'Maximum rights for independent non-clinical publisher; no clinical or infrastructure mutation',PolicyDocument:{Version:'2012-10-17',Statement:statements}},
        'A permissions boundary prevents later policy attachment from adding clinical or administration rights.', ['Exact new resources only','No distribution/function/IAM changes or deletes']);
    resource('Publisher','AWS::IAM::Role',{RoleName:sub('vetios-nonclinical-${AWS::StackName}'),MaxSessionDuration:3600,PermissionsBoundary:ref('PublisherBoundary'),
        AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:ref('GitHubIdentity')},Action:'sts:AssumeRoleWithWebIdentity',
            Condition:{StringEquals:{'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':sub('repository_id:${RepositoryId}:environment:vetios-nonclinical-production')}}}]},
        Policies:[{PolicyName:'NonclinicalPublicationOnly',PolicyDocument:{Version:'2012-10-17',Statement:statements}}]},
        'Human-approved fresh-repository OIDC sessions publish static bytes only.', ['Custom repository_id/context subject must be commissioned','No permission to assume another role']);
    return {AWSTemplateFormatVersion:'2010-09-09',Description:'Independent static non-clinical publication with a fixed private origin and a narrowly scoped release-pointer publisher.',
        Metadata:{AWSToolsMetrics:{AWSAgentToolkit:'aws-cloudformation@3'},'com.aws.cloudformation.Context':{
            arch:'Private S3 + fixed CloudFront/OAC + digest-only KVS pointer; GitHub-hosted non-clinical publication.',
            must:['No clinical application, data, APIs, learning, federation or runner','Prepare only; human bootstrap and publication authorization required','All Regional storage in eu-north-1'],ref:['README.md']}},
        Parameters:{RepositoryId:{Type:'String',AllowedPattern:'^[1-9][0-9]{0,14}$',Description:'Actual numeric ID of the fresh standalone repository; never the clinical repository'}},
        Rules:{IndependentRepository:{Assertions:[{Assert:{'Fn::Not':[{'Fn::Equals':[ref('RepositoryId'),'1161119818']}]},AssertDescription:'The clinical repository cannot publish through this track.'}]}},
        Resources:resources,Outputs:{ContentBucket:{Value:ref('Content')},AuditBucket:{Value:ref('Audit')},KeyValueStoreArn:{Value:attr('Pointer','Arn')},
            DistributionId:{Value:ref('Distribution')},Domain:{Value:attr('Distribution','DomainName')},PublisherRoleArn:{Value:attr('Publisher','Arn')},
            GuardFunctionArn:{Value:attr('RequestGuard','FunctionARN')},HeadersPolicyId:{Value:ref('Headers')},CachePolicyId:{Value:ref('Cache')}}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
    if(process.argv.length!==3)throw Error('usage: node infrastructure.mjs NEW_TEMPLATE_JSON');
    await fs.writeFile(process.argv[2],JSON.stringify(template(),null,2)+'\n',{flag:'wx',mode:0o600});
}

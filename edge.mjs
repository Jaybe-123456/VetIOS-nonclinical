import { ROUTES, HEADERS } from './policy.mjs';

// Executed verbatim in CloudFront runtime 2.0 after substituting its provider import.
export function edgeCode() {
    return `import cf from 'cloudfront';
var store = cf.kvs();
var routes = ${JSON.stringify(ROUTES)};
var security = ${JSON.stringify(Object.fromEntries(Object.entries({...HEADERS,'cache-control':'no-store'}).map(([key,value])=>[key,{value}])))};
function closed(code, message) { return {statusCode:code,statusDescription:message,headers:security}; }
async function handler(event) {
    var request = event.request;
    if (!request || ['GET','HEAD'].indexOf(request.method) < 0 || !Object.prototype.hasOwnProperty.call(routes, request.uri)
        || (request.headers && request.headers.authorization)) {
        return closed(403,'Forbidden');
    }
    var release;
    try { release = await store.get('activeRelease'); } catch (error) {
        return closed(503,'No authorized static release');
    }
    if (!/^[a-f0-9]{64}$/.test(release)) return closed(503,'No authorized static release');
    request.uri = '/releases/' + release + '/' + routes[request.uri];
    request.querystring = {};
    request.cookies = {};
    if (request.headers) { delete request.headers.cookie; delete request.headers.authorization; }
    return request;
}
`;
}

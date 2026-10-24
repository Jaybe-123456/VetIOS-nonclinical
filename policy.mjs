export const GOVERNANCE = Object.freeze({
    independent_reviewer_approval: 'NOT_ESTABLISHED', clinical_governance_approval: 'NOT_ESTABLISHED',
    governed_commissioning: 'INCOMPLETE', clinical_production_release: 'BLOCKED',
});
export const ROUTES = Object.freeze({
    '/': 'index.html', '/index.html': 'index.html', '/docs/': 'docs/index.html', '/docs/index.html': 'docs/index.html',
    '/demo/': 'demo/index.html', '/demo/index.html': 'demo/index.html', '/boundary/': 'boundary/index.html', '/boundary/index.html': 'boundary/index.html',
    '/assets/site.css': 'assets/site.css', '/assets/demo.js': 'assets/demo.js', '/release.json': 'release.json',
});
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'";
export const RELEASE_ORIGIN_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const HEADERS = Object.freeze({
    'cache-control': 'no-store',
    'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'strict-transport-security': 'max-age=31536000', 'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
});
export const PARENT_REPOSITORY = 'Karshadev/VetIOS';
export const PARENT_REPOSITORY_ID = 1161119818;
// Public-facing responsible individual affirmed by the user on 2026-10-24; legal entity registration and actual mailbox delivery remain separately unverified.
export const PUBLIC_OPERATOR_NAME = 'John Bruce';
export const shaPattern = /^[a-f0-9]{64}$/;
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }

// Read-only HTTPS monitoring; no AWS credentials, data store, inputs or mutations.
import assert from 'node:assert/strict';
import { canonical,GOVERNANCE,ROUTES,shaPattern } from './policy.mjs';
import { sha256 } from './build.mjs';
import { health } from './deploy.mjs';
const manifest=JSON.parse(process.env.NONCLINICAL_MONITOR_MANIFEST??'null');assert.ok(manifest,'commissioned immutable manifest required');
assert.equal(manifest.schema,'vetios-nonclinical-artifact-v1');assert.equal(manifest.production_authorized,false);assert.deepEqual(manifest.governance,GOVERNANCE);
assert.match(manifest.source_sha256,shaPattern);assert.match(manifest.artifact_sha256,shaPattern);
assert.deepEqual(manifest.members.map(m=>m.path).sort(),[...new Set(Object.values(ROUTES))].sort());
assert.equal(sha256(canonical({schema:manifest.schema,source_sha256:manifest.source_sha256,members:manifest.members})),manifest.artifact_sha256);
const domain=process.env.NONCLINICAL_MONITOR_DOMAIN;assert.match(domain,/^d[a-z0-9]{5,40}\.cloudfront\.net$/);
process.stdout.write(canonical(await health({domain},manifest))+'\n');

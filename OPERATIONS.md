# Non-clinical operations

This repository publishes only the closed static artifact defined by `ROUTES` and `SOURCE_FILES`. Do not connect clinical services, credentials, patient records or clinical domains. Git history must remain independent of the clinical repository. Keep provider-specific publication authority separate from clinical authorization.

## Commission public operations

John Bruce is the owner-designated operator. Before publication, retain actual inbound/reply delivery records for platform@vetios.tech, an independently triggered incident event and acknowledgement, provider confirmations, sanitized message/event identifiers, timestamps, response hours and retention terms. Keep private records outside this repository. Source tests and a selected contact address do not establish delivery or acknowledgement.

Verify actual repository/branch and deployment-environment protections, provider identities, least-privilege credentials, public content/privacy review, artifact digests and the explicit publication decision. Record failed or ambiguous provider actions; never turn them into successful receipts. Provider configuration and credentials must be independent of the clinical application.

## Monitoring

`node monitor.mjs` uses HTTPS only and needs no deployment credentials.

| Result | Meaning | Exit |
| --- | --- | --- |
| `NOT_COMMISSIONED` | The committed policy is uncommissioned and all runtime configuration is absent; no request was sent and public health is unknown | 0 with notice |
| `CONFIGURATION_ERROR` | Missing/invalid policy, unexpected precommissioning configuration, or lost/changed commissioned configuration; health is unknown | 1 |
| `PROBE_FAILED` | Network, access, content, header or forbidden-endpoint check failed; health is unknown | 1 |
| `OBSERVED_HEALTHY` | All configured public artifact probes passed at this observation time | 0 |

Commissioning requires a reviewed change to `monitor-policy.json`: set `state` to `COMMISSIONED`, the provider to `VERCEL` or `AWS_CLOUDFRONT`, and the exact approved domain. Vercel is restricted to `vetios-public-static.vercel.app`. Protect this source file and the workflow on main; do not revert the state simply to silence a failure.

Configure these protected repository variables after the deployment artifact and actual commissioning decision are known:

- `NONCLINICAL_MONITOR_DOMAIN`: the same approved domain.
- `NONCLINICAL_MONITOR_MANIFEST`: the complete immutable `artifact.json` bytes for the published artifact.
- `NONCLINICAL_MONITOR_MANIFEST_SHA256`: SHA-256 of those exact bytes, including any final newline.

Keep the artifact manifest/digest outside the source policy to avoid a circular source hash. The manifest pin detects changes; it is not a signed approval. Validate the settings and run a manual monitor observation during the authorized commissioning window. Once commissioned, removal of any variable fails. A public probe uses no protection bypass and must fail if visitors see a login page. AWS and Vercel have different expected rejection statuses; provider selection must match the reviewed target.

The schedule is not a guaranteed 15-minute delivery SLA. An actual observer must verify GitHub failure notifications reach the named operator, with recorded acknowledgement and response hours. A `NOT_COMMISSIONED` result is never an uptime observation or permission to publish. Decommissioning requires an accountable record of the removed public service, not just empty variables.

## AWS publisher

`infrastructure.mjs` defines the isolated private S3/CloudFront target. `deploy.mjs` owns configuration validation, GitHub authorization readback, commissioning records, immutable artifact publication, conditional release-pointer changes, health probes, suspension and rollback. The manual publisher remains disabled by `deployment.example.json` until actual identities and approvals exist. Vercel uses separate provider commissioning.

Validate the generated template with the workflow's pinned cfn-lint and cfn-guard before any authorized bootstrap. Verify the project's assigned Region, plan/service eligibility, costs, retention decision, OIDC subject, permissions boundary and actual cloud policies. Publisher permissions exclude deleting evidence and bypassing retention. No template validation creates resources or approves spending.

Store real deployment configuration in the protected `NONCLINICAL_DEPLOYMENT_CONFIG` variable. Follow `validateConfig`, `validateContentPrivacyReview` and `publicationAuthorization` for the closed record schemas and digest bindings. Records stay in the dedicated private audit store, never in public content. Require actual environment authorization and an exact artifact decision for publish/rollback. First publication has no earlier healthy release: rehearse suspension. A rollback needs a genuine earlier healthy receipt. Ambiguous writes remain `UNKNOWN` and require readback before a new authorized attempt.

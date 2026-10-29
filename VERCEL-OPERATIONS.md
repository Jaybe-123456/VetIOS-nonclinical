# Protected static delivery

The manual `Protected Vercel static delivery` workflow targets only
`jaybe-123456/vetios-public-static`, project `prj_MVmnInTDo2XZAym9MrvQIYx5UXnE`.
It cannot create a project, change protection, attach domains, build clinical code,
or promote automatically. Provider behavior still requires live commissioning.

## Configure authority before credentials

An authorized repository administrator must preserve existing protections and require:

- `main`: enforced for administrators, strict `qualify` from GitHub Actions,
  at least one approving PR review, stale review dismissal, approval of the latest
  push, no review bypass, force push or deletion.
- Environment `vetios-public-static-vercel`: named independent human reviewer,
  prevent self-review, no administrator bypass, only the `main` branch.
- Repository secret `NONCLINICAL_GITHUB_READ_TOKEN`: a fine-grained token limited
  to this repository, with metadata, contents, pull requests, checks, actions,
  environments, variables and administration **read** permissions. No write permission.
  Administration read is needed to inspect classic protection; the default
  Actions token and the connected integration may return 403.

The publisher checks live policy, the actual merged PR's latest-head approval,
the exact main qualification and the actual workflow environment approval.
PR #5's unreviewed merge cannot satisfy this policy. Merge this engineering PR
only through an independent review. Re-runs are rejected; dispatch a new run.

After these protections are established, configure `VERCEL_TOKEN` only as an
environment secret, scoped to the existing team/project through the provider's
available access controls. Review effective permissions; never use a clinical
team credential. Keep Git automatic deployment disconnected and runtime envs empty.
The publisher uses Node's built-in HTTPS client and the Vercel prebuilt upload
contract; no CLI, builder or third-party dependency runs with provider credentials.

Local human inspection can use `vercel curl`. CI's complete byte/header probes
use the separately commissioned project-specific `VERCEL_AUTOMATION_BYPASS_SECRET`
environment secret, sent only to the verified generated deployment hostname,
without redirects or cookies. Do not disable SSO. Never put either secret in a
dispatch input, command argument, receipt or repository file.

## Stage and test

1. Obtain the artifact SHA-256 from successful `qualify` on the approved main commit.
2. Dispatch `mode=stage`, that `artifact_sha256`, and empty remaining inputs.
3. The independent environment reviewer approves that run and commit. The job
   revalidates source, qualification, scanner logs and output bytes before running
   Vercel's production-target prebuilt upload with automatic domain assignment
   disabled. No build or environment pull occurs.
4. Inspect artifact `vercel-release-RUN_ID/outcome.json`. `STAGED_VERIFIED` means
   production-target bytes were checked behind protection with no alias assignment.
   It does not establish anonymous public health or authorize publication.

The receipt binds the commit, source, artifact, verification, security and output
digests to the actual deployment ID. Preserve its exact bytes and SHA-256. The
workflow downloads later receipts from their original successful workflow runs;
it does not accept an arbitrary URL, local replacement or preview deployment.

## Operational records

No actual mailbox delivery or incident acknowledgement is established yet.
John Bruce must perform the handoff with an independent tester and retain real,
sanitized provider records in private controlled storage:

- Inbound send/delivery, reply send/delivery, operator acknowledgement, and hashes
  of sanitized message IDs and provider records.
- Independently triggered alert, provider event ID hash, delivery and John Bruce's
  acknowledgement times; response hours and retention policy.
- Operator acceptance, identity/privacy, Vercel access/retention, security review,
  and a real suspension drill record. Each record has a SHA-256 reference.

`commissioning-intake.mjs` defines the closed metadata schema. It excludes message
bodies, raw credentials, patient data and arbitrary added fields. Keep the packet
outside the repository with mode 0600, then run:

```bash
node commissioning-intake.mjs /private/packet.json /private/new-intake-receipt.json
sha256sum /private/packet.json
```

Intake checks structure, chronology, hashes, expiry and private-file integrity;
it always returns `IMPORTED_UNAPPROVED`. A hash does not prove a delivery occurred.
The independent reviewer must inspect the referenced original provider records,
verify the operator's acceptance and record their decision privately. Only then
may an authorized environment administrator install the exact packet:

```bash
gh secret set NONCLINICAL_COMMISSIONING_PACKET --repo Jaybe-123456/VetIOS-nonclinical --env vetios-public-static-vercel < /private/packet.json
gh variable set NONCLINICAL_COMMISSIONING_SHA256 --repo Jaybe-123456/VetIOS-nonclinical --env vetios-public-static-vercel --body 'ACTUAL_REVIEWED_SHA256'
```

No private packet is uploaded as a CI artifact. The protected digest and a new
independent environment decision are both required for promote/rollback. Records
expire within 30 days; renew them through actual review, not edited test fixtures.

## Suspend, publish and recover

To exercise the first recovery path, dispatch `suspend` with the staged artifact
digest, its `prior_run` and exact `receipt_sha256`. After independent approval the
job pauses this project and verifies provider state plus a real 503
`DEPLOYMENT_PAUSED` response on the staged production URL. A new unpause decision
must be made by the owner in Vercel; this workflow never resumes service itself.
After that decision, stage and test a new candidate. Retain the drill receipt for
the commissioning review. Do not invent an earlier healthy deployment.

Before publication, commission `monitor-policy.json` through a reviewed change
and stage that exact new source. Set the three **repository-level** monitor
variables (`NONCLINICAL_MONITOR_DOMAIN`, `NONCLINICAL_MONITOR_MANIFEST`,
`NONCLINICAL_MONITOR_MANIFEST_SHA256`) to the fixed hostname and exact bytes/hash
of the staged `artifact.json`. Do not shadow these with environment variables.
Missing configuration after commissioning fails. Scheduled probes use no bypass
credential and must observe the same public artifact after promotion.

Dispatch `promote` with the staged receipt/run, artifact digest, and explicit
`public_access=vetios-public-static.vercel.app`. The reviewer approves public access
to this exact deployment. The job checks commissioning, monitoring, protected
staging and current source again, then promotes that production deployment ID.
It checks the actual production alias and anonymous GET/HEAD bytes, headers and
forbidden endpoints. SSO remains enabled; a setting that protects every production
domain must be resolved separately by its owner before this action.

`rollback` accepts only a previous `PUBLISHED_VERIFIED` receipt from a successful
trusted run, with a new approval, current commissioning and the monitor pinned to
that prior artifact. It rechecks and selects that same deployment without rebuilding.
It cannot manufacture a first rollback baseline. `suspend` remains available when
operational records expire. If a response or post-mutation probe fails, inspect
`uncertain.json` and provider state. Never retry blindly or infer that no change
occurred. If CI is unavailable, an authorized owner can pause this exact project
in Vercel and privately record the observed result.

GitHub artifacts expire (release receipts: 90 days). Archive reviewed receipts and
their hashes to the organization's governed retention store before expiry. A
missing, expired or failed prior-run artifact blocks automated reuse.

References: [Vercel staged production promotion](https://vercel.com/docs/deployments/promoting-a-deployment),
[deployment protection](https://vercel.com/docs/deployment-protection),
[project suspension](https://vercel.com/docs/projects/managing-projects).

The prebuilt transport follows Vercel client source at
[`84878e532142f0ac584953695658b324eb9e5b80`](https://github.com/vercel/vercel/tree/84878e532142f0ac584953695658b324eb9e5b80/packages/client/src):
`utils/query-string.ts` (`prebuilt=1`), `deploy.ts` (v13 create), and the CLI's
`--skip-domain` mapping (`autoAssignCustomDomains=false`). Inline base64 files use
the [deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment).
The general API documentation does not enumerate the prebuilt query; this part
is a version-pinned client contract and requires a live protected staging test
before operational qualification. Alias verification uses the actual
[deployment alias inventory](https://vercel.com/docs/rest-api/aliases/list-deployment-aliases),
not the provider's alias-processing timestamp.

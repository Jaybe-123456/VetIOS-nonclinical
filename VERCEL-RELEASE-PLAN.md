# Vercel isolated public-static release — deployment qualification

Status: **DRAFT / NO PUBLICATION APPROVAL / NO CLINICAL RELEASE**.

Owner-designated accountable human (confirmed by user): **John Bruce** — nonclinical content/operator contact administration and production incident ownership.

Not yet verified: precise legal operator registration, mailbox read/write control, provider/retention, delivery + incident alert tests, response availability, review of Vercel provider metadata/region, final security clearance and immutable human publication approval. These must remain blocking for public publication.

## Proposed independent architecture
- Vercel team `jaybe-123456` (`team_2hXyZAfOnzEDHqhMTVytianf`), separate project `vetios-public-static` (`prj_MVmnInTDo2XZAym9MrvQIYx5UXnE`; created, default hostname `vetios-public-static.vercel.app`).
- Project must use ONLY an independently qualified static export artifact from this repository: `index.html`, `docs/index.html`, `demo/index.html`, `boundary/index.html`, `assets/site.css`, `assets/demo.js`, `release.json`.
- No `api/`, serverless functions, clinical data, server-side inference, auth, database, user uploads, form endpoints, analytics SDKs, external scripts or application rewrites.
- This is a separate target from the existing AWS/CloudFront nonclinical proposal. AWS commissioning records do not automatically authorize Vercel. Provider/privacy review must explicitly address Vercel.
- GitHub clinical repo historical findings and clinical gate remain separate and unresolved; no copy of its history or credential material.

## Required prepublication evidence
1. Verified accountable legal operator identity appropriate for the privacy page (individual vs registered legal entity); currently only responsible person affirmed.
2. Successful bidirectional test of `platform@vetios.tech`; actual provider, admin and retention disposition.
3. Incident owner explicit acceptance, response hours and alert-delivery test.
4. Source and artifact hash, source isolation, clean scan of standalone static bytes, all static route/negative tests and browser checks.
5. Correct Vercel static output directory and headers; verify GET/HEAD 200 for allowlisted paths, no API behavior, and blocked invalid methods/paths.
6. Written actual scope-bound human publication decision on exact artifact SHA, project, hostname, and rollback mechanism. Do not invent signed approvals.
7. Verify Vercel Authentication setting (current project has protection `all_except_custom_domains`), visitor access expectations and project billing impacts.
8. After testing, production can be published to the default hostname only. No domain attachments, merge to the clinical repo, or clinical deployment.

Do not treat synthetic fixtures, GitHub code reviews or this document as a human release decision. The operator designation by itself is **not** complete commissioning.

## Executable qualification (does not publish)

```bash
npm ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
node verify.mjs /absolute/new-private-run
GITLEAKS=/absolute/checksum-verified/gitleaks node security.mjs --static-only /absolute/new-private-security /absolute/new-private-run/candidate
```

Use the checksum-pinned scanner installation in `.github/workflows/nonclinical.yml`.
Only `/absolute/new-private-run/vercel/.vercel/output` is a deployment artifact;
receipts, screenshots, scanner evidence and source files stay outside it.
The verifier reuses the existing static generator and binds executed test/browser
files, unique captures, source and content hashes before packaging. It rejects
changed evidence, extra files/directories, symlinks and dynamic Vercel primitives.
Local HTTP/browser checks exercise the generated routing configuration. Hosted
Vercel behavior, access protection and rollback still require actual commissioning.
The Build Output API contract is documented at
https://vercel.com/docs/build-output-api/configuration .

Read-only integration observation on 30 October 2026: the project exists in the
exact team above, is not live, has no latest deployment or deployment records,
and has no project environment variables. Vercel Authentication is enabled for
`all_except_custom_domains`. The complete verified domain inventory currently
contains both `vetios-public-static.vercel.app` and `public.vetios.tech`.

The selected release target is the default hostname only. The `public.vetios.tech`
association must be detached from this project before any stage or publication;
under the current protection scope, custom production domains are public. There
is no deployment now, so this finding does not establish a live-site outage. The
connected Vercel integration available to this workflow has no project-domain
detach operation. A Vercel team operator must remove the project association
from the project's Domains tab using that domain's More Options → Delete action;
this removes only the project association. Retain its team ownership, then
re-read the complete project-domain inventory. Do not use `vercel domains remove`,
which removes the domain from the team. The release preflight rejects any domain
inventory other than the single verified default hostname. See Vercel's
[project-domain removal instructions](https://vercel.com/docs/domains/working-with-domains/remove-a-domain).

The IDE CLI uses a different account, so use the authorized integration or
Vercel dashboard for this scoped setting. Never recreate this project. Keep
preview protection enabled, and separately approve the intended anonymous
production access before promotion. See Vercel's
[Deployment Protection documentation](https://vercel.com/docs/deployment-protection).

## Owner evidence intake

John Bruce must provide a dated, scope-bound record of the mailbox provider,
administrators, retention, response availability and incident routing. Test a
random harmless nonce into `platform@vetios.tech`, have its authorized operator
reply with that nonce, and separately trigger the configured incident-monitor test.
Retain sanitized message IDs, UTC send/delivery/acknowledgement times, route,
recipient confirmation and provider delivery events. A DNS/MX lookup or a generated
fixture does not establish delivery. Do not include mail bodies, tokens, patient
records or private keys. Store evidence in private owner-controlled storage; hand
off only its location, SHA-256, purpose and named reviewer. No actual delivery or
alert acknowledgement is established by this document.

Before publication, independently inspect the source/artifact/verification hashes,
provider privacy/retention settings, team/project access, protected preview,
production access intention and the exact hostname. Record a real publication
decision bound to those hashes and the project IDs. With no previous deployment,
rollback readiness means a tested suspension path; do not invent a previous healthy
release. Neither AWS authorization nor the parent clinical approval substitutes.

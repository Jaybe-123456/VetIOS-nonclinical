# Vercel isolated public-static release — deployment qualification

Status: **DRAFT / NO PUBLICATION APPROVAL / NO CLINICAL RELEASE**.

Owner-designated accountable human (confirmed by user): **John Bruce** — nonclinical content/operator contact administration and production incident ownership.

Not yet verified: precise legal operator registration, mailbox read/write control, provider/retention, delivery + incident alert tests, response availability, review of Vercel provider metadata/region, final security clearance and immutable human publication approval. These must remain blocking for public publication.

## Proposed independent architecture
- Vercel team `jaybe-123456`, separate project `vetios-public-static` (created, default hostname `vetios-public-static.vercel.app`).
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

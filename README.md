# VetIOS public site

Standalone static website, architecture documentation and a fixed synthetic evidence demonstration for VetIOS. It contains no patient inputs, clinical inference, accounts, databases or clinical APIs.

## Verify locally

Use Node 24.20.0 and the committed npm lockfile:

```bash
npm ci --ignore-scripts
npx --no-install playwright install chromium
npm test
node verify.mjs /absolute/new/evidence-directory
```

Verification checks source and artifact integrity, deterministic builds, rejected routes, security headers and desktop/mobile browsers. The receipt records engineering results; publication requires separate operational authorization.

## Release paths

- **Vercel:** static Build Output API packaging and qualification are implemented. See [Vercel release requirements](VERCEL-RELEASE-PLAN.md).
- **AWS:** a separate S3/CloudFront publisher, suspension and rollback path are implemented. See [operations](OPERATIONS.md).
- **Clinical:** clinical application releases retain their own security, evaluation and independent authorization gates in the clinical repository.

The designated public operator is John Bruce. Mailbox delivery, incident routing and provider commissioning still require real records. This candidate is not commissioned for publication.

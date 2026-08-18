# Security policy

## Reporting

Use GitHub private vulnerability reporting for security issues. Do not post credentials or exploit details in a public issue.

## Secret handling

Cloudflare deployment credentials must be configured with `wrangler secret put`. If a secret is committed or otherwise exposed, revoke it at the provider first, replace it with a new value, remove it from every reachable Git ref, and ask GitHub Support to clear affected cached views when necessary.

The Worker intentionally fails closed when `MCP_AUTH_TOKEN` or `SEATS_AERO_API_KEY` is missing. Application logs must not include authorization headers, upstream credentials, full MCP payloads, or rate-limit fingerprints.

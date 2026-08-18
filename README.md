# Rewards Flight MCP Server

An experimental Model Context Protocol server that exposes read-only award-flight search tools backed by the Seats.aero Partner API. It runs on Cloudflare Workers and uses the Streamable HTTP transport at `/mcp`.

## Project status

This repository is a security-hardened prototype, not a finished multi-tenant platform. It has a shared bearer-token boundary, an origin allowlist, and Cloudflare Worker rate limiting. A production deployment should replace the shared token with MCP OAuth/Cloudflare Access, issue per-user scopes, add audit events and alerts, and complete a threat model and load test.

## Security model

- Every `/mcp` request requires `Authorization: Bearer <token>`.
- Credentials are compared using SHA-256 digests and Cloudflare's timing-safe comparison API.
- Browser requests are accepted only from `MCP_ALLOWED_ORIGINS`; native MCP clients may omit `Origin`.
- Authenticated and unauthenticated requests are rate limited without storing raw credentials in the rate-limit key.
- The Seats.aero key and MCP bearer token are Wrangler secrets. No credential belongs in source, `.dev.vars`, logs, commits, issues, or pull requests.
- The old HTTP+SSE routes are intentionally not exposed.

Report a vulnerability privately using GitHub's **Security → Report a vulnerability** flow. Do not open a public issue containing secrets.

## Local setup

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Create `.dev.vars` locally with new, non-production values:

```dotenv
SEATS_AERO_API_KEY=replace-with-a-rotated-key
MCP_AUTH_TOKEN=replace-with-a-long-random-token
MCP_ALLOWED_ORIGINS=https://your-client.example
```

`.dev.vars` is ignored by Git. Never reuse the credential removed from the previous repository history.

## Cloudflare deployment

Authenticate Wrangler, configure newly rotated secrets, then deploy:

```bash
npx wrangler login
npx wrangler secret put SEATS_AERO_API_KEY
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put MCP_ALLOWED_ORIGINS
npm run deploy
```

The Worker keeps the legacy Cloudflare service name in `wrangler.jsonc` so deploying updates the existing endpoint instead of leaving an authless service behind. Connect clients to `https://<worker>.<account>.workers.dev/mcp` and supply the bearer token through the client's secure credential mechanism.

## Quality checks

```bash
npm run type-check
npm run lint
npm test
```

GitHub Actions runs these checks on pushes and pull requests.

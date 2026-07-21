# Backend status

## POC agent preparation API

- `GET /api/v1/poc/capabilities`
  - Hosted: reports deterministic-only capability.
  - Local web API: proxies the loopback bridge when explicitly enabled and strips
    its ephemeral bearer token before responding to the browser.
  - Direct loopback bridge capabilities include the token for the trusted local
    web process only. Every browser `Origin` is rejected.
- `POST /api/v1/poc/runs`
  - Body: `{ "prompt": string, "executionMode": "auto" | "demo" }`.
  - The browser calls only the same-origin route. The server-side proxy adds
    `X-AI-Office-Bridge-Token`; `Idempotency-Key` is supported.
  - Success: provider-neutral role outputs, six visual workflow stages, execution
    metadata, final brief, and Git issue draft.
  - Errors use `{ error: { code, message, retryable, correlationId } }` where the
    Web API controller is used.

## Current local POC runtime

- `npm run poc:bridge` starts the OpenCode 1.4.3 Zen profile with an explicit
  `synthetic-only` shared-XDG acknowledgment.
- `npm run dev:poc -- -H <exact Tailscale IPv4>` exposes only the web server to the
  tailnet. The bridge remains on `127.0.0.1:4317`.
- Raw UI text remains local and is mapped to a server-owned Synthetic FlashSim
  scenario before the external model call.
- Runtime limits: one concurrent request, no queue, ten requests/hour, one model
  attempt, no provider/demo fallback.
- The six UI roles are logical stages in one OpenCode process/model turn for this
  POC. A future internal runtime can fan out real subagents behind the same ports.
- Hosted execution deliberately cannot spawn a CLI and remains deterministic.
- Zen shared global XDG state, local-process trust, and tailnet-ACL-only web access
  are documented time-bounded POC residuals; company data remains prohibited.

No breaking external API existed before this POC.

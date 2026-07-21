# Backend status

## POC agent preparation API

- `GET /api/v1/poc/capabilities`
  - Hosted: reports deterministic-only capability.
  - Local bridge: reports the explicitly enabled runtime and returns the ephemeral
    bridge token. Response is `Cache-Control: no-store`.
- `POST /api/v1/poc/runs`
  - Body: `{ "prompt": string, "executionMode": "auto" | "demo" }`.
  - Headers: `Content-Type: application/json`; local bridge additionally requires
    `X-AI-Office-Bridge-Token`. `Idempotency-Key` is supported.
  - Success: provider-neutral role outputs, six visual workflow stages, execution
    metadata, final brief, and Git issue draft.
  - Errors use `{ error: { code, message, retryable, correlationId } }` where the
    Web API controller is used.

Local command: `npm run poc:bridge` (Codex, synthetic data only). Fallback command:
`npm run poc:bridge:demo`. Hosted execution deliberately cannot spawn a CLI.

No breaking external API existed before this POC.

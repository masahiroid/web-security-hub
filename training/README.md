# Local training fixtures

Start with the [English course](../docs/training/README.md) or [日本語教材](../docs/training/README.ja.md).

- `sample-site/server.js`: loopback-only bilingual workshop application. In-memory `baseline`, `changed`, `fixed` modes. No submission persistence or external services.
- `sast/before/example.js`: inert examples for two SAST rules, never imported by the server.
- `sast/after/example.js`: remediated comparison fixture.
- `../sites/training-{ja,en}/site.config.json`: non-secret, reproducible Hub configurations. Run `npm run training:setup` to create the ignored demo credential files.

## Fixture contract

| Behavior | baseline / fixed | changed |
|---|---|---|
| Participant HTML and server limit | 1–5 | 1–3 |
| Completion reference | LAB-0001 | LAB-0001 for valid input |
| Application CSP and nosniff headers | present | absent |
| Data | fixed dataset 2026-01 | same dataset |

`fixed` restores the exact baseline appearance so visual regression can return to PASS. Mode is server-wide, changes through local `POST /__training/mode`, and resets on server restart or `POST /__training/reset`. Login uses fixed dummy credentials and a demo cookie. It is not a production authentication implementation.

Add future bug reproductions as narrowly scoped modes/routes, deterministic inputs and independently specified expectations. Keep the core fixture contract stable so existing training remains reproducible.

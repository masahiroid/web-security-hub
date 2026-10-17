# Verifier foundation / 検証基盤

This is a backend foundation, not a connected scanning feature. LLM, MCP,
Playwright execution, AST slicing and OpenVEX export are not implemented here.

現在はバックエンド基盤です。既存診断画面への接続、LLM／MCP、Playwright実行、
AST解析、OpenVEX出力は後続段階です。

- `contracts`: versioned schemas and shared strict validation for seeds, scopes,
  slice metadata, evidence, feedback and draft assessments. Missing observations
  are explicit. No finite trial result emits `not_affected`.
- `policies`: trusted root/profile catalogs; private random job capabilities;
  exact loopback origin, route, method, field and profile restrictions; expiry,
  trial and concurrency budgets; cancellation and source-path confinement.
- Private output location: `VERIFIER_DATA_DIR` from `core/paths.js`, under
  ignored `artifacts/private/verifier`. No evidence is written automatically.

`begin()` reserves a trial and returns a shared job AbortSignal and deadline.
Cancellation or expiry aborts the signal. `status()` returns counts/state without
the capability; `dispose()` aborts and removes the job. Callers must use
`finish()` in `finally`, enforce
cancellation during I/O, block redirects before following, and isolate each
profile/context. These helpers do not themselves execute or interrupt requests.
`sourceFile()` checks a canonical path; a future reader must verify the digest
of bytes actually consumed and handle concurrent filesystem changes.
Capabilities and authentication state must never appear in public job metadata.
No model or paid provider calls exist in this phase.

## Local fixture / ローカル専用サンプル

```sh
npm run verifier:test
npm run verifier:fixture
```

The synthetic-data fixture listens only on `127.0.0.1:4181`, separate from the
existing training site at port 4180. Do not deploy or mount it publicly.
It deliberately permits invalid ownership/workflow in `changed` mode.
`baseline` and `fixed` enforce ownership and per-session confirmation.

専用サンプルは架空データだけを扱います。`changed` は意図的に所有権・確認手順を
欠落させます。公開サーバーへ配置しないでください。既存の教材は変更しません。

For automated tests, `createFixture()` returns an Express app, source digest
and a private control token. `POST /control` requires `X-Fixture-Control`:
`{"action":"reset","mode":"baseline|changed|fixed"}` or
`{"action":"evidence"}`. Reset invalidates all sessions. The standalone command
never prints the control token; use the factory for controlled experiments.
`POST /session` selects fake `learner-a`, `learner-b`, `admin` or `anonymous`.
These are fixture roles, not application authentication.

Read `/records/record-a` or `/records/record-b`; POST to their `/confirm` and
`/complete` paths using the same session cookie. Evidence records actual fake
commits, ownership/confirmation violations, mode and source digest, without
cookies or submitted values. The `/boundary` endpoint accepts integer
participants 1–5 and a label containing 1–10 Unicode code points after NFC.
Instrumentation can be disabled explicitly through the factory; absence must
be represented as `unavailable`, never inferred as an unreached server sink.

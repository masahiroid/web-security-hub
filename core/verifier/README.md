# Verifier foundation / 検証基盤

This is a backend foundation, not a connected scanning feature. LLM, MCP,
browser UI execution, AST slicing and OpenVEX export are not implemented here.
An isolated Playwright APIRequestContext runner is available for local HTTP trials.

現在はバックエンド基盤です。独立したPlaywright APIRequestContextによるHTTP試行に対応します。
既存診断画面への接続、LLM／MCP、ブラウザーUI実行、
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

## HTTP runner / HTTP試行

`createHttpRunner({ registry, profiles, controls, timeoutMs, evidenceSource })` in
`runners/httpRunner.js` receives catalogs from the trusted backend.
Each profile fixes its numeric loopback origin and up to four explicit POST
setup steps (for example, the fixture's fake session selector). Catalogs are
validated and copied; a seed cannot supply setup, cookies, headers or a URL.
These are fixture setup profiles; real application credential storage is a
separate integration task.

`run(handle, { url, method, authProfileId, seed })` reserves one trial and creates
a fresh API request context. `runPair()` first executes a separately configured
normal seed, in another fresh context. It checks both the expected HTTP status
and expected scalar JSON fields. A failed control skips the candidate. Both
control and candidate consume the job's trial budget; setup steps are bounded
separately by the profile and the same trial timeout. Pair reservations are
sequential; exhausted budgets or cancellation between trials can reject the
second trial, so callers must handle rejection as an incomplete pair.

POST values are JSON; GET values become encoded query strings. `omitFields`
never gets merged with defaults: only `values` is sent. Direct HTTP trials do
not test browser form validation or UI transitions. UI steps will use the
shared step executor in a separate runner.

All automatic redirects and retries are disabled, including during setup.
Redirect responses are recorded and stopped, including an otherwise allowed
same-route redirect. Cancellation, expiry and trial timeout dispose the context
and release reservations. Every target dispatch has unique job/trial/request
IDs and the seed ID in `X-Verifier-*` headers. `dispatched` means the target
fetch was invoked, not proof that the server received or executed it.

Results contain validated observation metadata, correlated evidence, feedback and
a draft assessment. Cookies, body values, raw response headers, redirect URLs
and transport exception messages are excluded. A 64 KiB check limits response
JSON inspection **after Playwright has buffered the response**; it is not a
streaming network-size limit. Targets remain controlled local fixtures.
Optional fixture instrumentation verifies server reachability, build digest and
independent business-oracle evidence. Status 200/403/500 alone never establishes
a vulnerability or absence of one. The pair's `completed` state describes execution, not a safe
or affected verdict.

HTTP試行はseedごとに認証状態を分離します。正常対照の失敗時は候補を実行せず、
応答コードだけでは脆弱性や安全性を判定しません。取消・期限切れ・timeoutで通信を
閉じます。専用fixtureのサーバー側計測・独立oracleに対応し、GUIへの接続は後続段階です。

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


## Correlated evidence / 相関を確認した証拠

The backend can supply the fixture's private evidence port:

```js
const evidenceSource = {
  expectedSourceDigest: fixture.sourceDigest,
  currentSourceDigest: signal => fixture.currentSourceDigest(signal),
  read: async correlation => fixture.readEvidence(correlation)
};
```

This is a factory-level integration; it adds no HTTP control API to the main
application. All five identifiers (job/trial/seed/request/profile) must match.
The loaded build fingerprint covers fixture routes, policy definitions, oracle
and ledger code. Current disk bytes are checked before and after evidence read.
A mismatch, missing/disabled/truncated trace, unknown fields, duplicate IDs or
unavailable collection produces inconclusive feedback. Evidence collection is
bounded by cancellation and the remaining trial/job time budget.

For ownership checks the server oracle is independent of route guards; a read
also requires a matching record response before it counts as disclosure.
For workflow checks the event is recorded after the actual fake commit.
A trusted control may fix its own `authProfileId` (for example, a confirmed
owner), while the candidate uses another granted profile in a fresh context.
With evidence enabled, the normal control must also have verified, passing
oracle evidence. Only a verified violation plus a passing control can produce
the internal `reproduced` result. Every assessment remains a draft with VEX
status `under_investigation`; no OpenVEX exporter is implemented yet.

証拠は5つのIDと実行ソースのdigestを照合します。未計測・欠落・上限到達・digest不一致を
「Sinkに到達しなかった」とは扱いません。所有権違反は応答内容も確認し、確認手順の違反は
実際の架空データ更新後に記録します。HTTP200のエラーページだけで再現成功にはしません。

## TypeScript development / 段階的なTypeScript移行

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build:verifier
npm test
```

`typed/domain` contains pure policies and oracle rules; `typed/application`
orchestrates use cases through typed ports; `typed/adapters` owns Playwright,
source reads and the fixture ledger. Existing CommonJS callers use the small
`runners/httpRunner.js` facade. Limits/protocol/fixture definitions are named in
`typed/domain/config.ts`; operational timeout and evidence capacity are bounded
factory options. TypeScript uses strict mode and emits normal CommonJS JavaScript
to ignored `generated/`. Do not edit emitted files.

Tests and the fixture command build automatically. Desktop preparation builds
before staging, includes emitted JavaScript and excludes TypeScript sources and
the compiler. Installed users need no TypeScript tooling. Remaining legacy
JavaScript modules will migrate incrementally with behavior tests.

新しい検証処理はstrictなTypeScriptで追加し、既存JSは互換入口を残して段階的に整理します。
生成JSはGit対象外ですが、配布時にコンパイルして同梱するため、利用者の環境でコンパイルは不要です。

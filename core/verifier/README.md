# Verifier foundation / 検証基盤

The desktop Sample verification workspace and CLI run isolated local fixture
campaigns through Playwright APIRequestContext. LLM, MCP, browser UI execution
against targets, executable AST slicing and OpenVEX export are not implemented here.

アプリの「サンプル検証」画面とCLIから、専用サンプルを独立した
Playwright APIRequestContextによるHTTP試行で検証できます。
LLM／MCP、対象サイトのブラウザーUI実行、
実行用ASTスライス、OpenVEX出力は後続段階です。

- `contracts`: versioned schemas and shared strict validation for seeds, scopes,
  slice metadata, evidence, feedback and draft assessments. Missing observations
  are explicit. No finite trial result emits `not_affected`.
- `policies`: trusted root/profile catalogs; private random job capabilities;
  exact loopback origin, route, method, field and profile restrictions; expiry,
  trial and concurrency budgets; cancellation and source-path confinement.
- Private output location: `VERIFIER_DATA_DIR` from `core/paths.js`, under
  ignored `artifacts/private/verifier`. The single-trial API does not write files; the fixture campaign saves private reports.

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
閉じます。専用fixtureのサーバー側計測・独立oracleに対応します。
画面操作は[日英のハンズオン教材](../../docs/training/VERIFIER.ja.md)を参照してください。

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


## Run a complete local campaign / 一連の検証を実行する

```sh
npm run verifier:run -- --mode baseline
npm run verifier:run -- --mode changed
npm run verifier:run -- --mode fixed
```

Each command owns a fresh fixture on an ephemeral numeric loopback port and
closes it after the run. It does not connect to an existing/public site or
change the original training site at port 4180. The default plan covers boundary
and Unicode inputs, ownership (A/B/admin/anonymous), and confirmation workflow.
Baseline/fixed have no reproduced violations; changed deliberately reproduces
four known fixture violations. This is an internal finding count, not an OpenVEX
status. Normal controls run in separate authenticated contexts before candidates.

The JSON summary prints paths to private `report.json` and bilingual `report.html`.
Open the HTML file locally to inspect results and evidence. Reports are stored at
`DATA_ROOT/artifacts/private/verifier/<report-id>/`; `DATA_ROOT` follows the existing
`WEB_SECURITY_HUB_DATA_DIR` setting. No cloud service or model is used.

```sh
npm run verifier:run -- --scenario ownership --random-seed 42 --max-trials 12
npm run verifier:run -- --help
```

`--max-candidates` limits each scenario; `--max-trials` includes the normal control
and candidate (two reservations per complete pair). A partial pair is not started
when fewer than two reservations remain. `--ttl-ms` bounds the whole verification
run. SIGINT/SIGTERM cancel the owned jobs, close the fixture, and save partial
results. All planned candidates stay in the report, including unexecuted ones.
A completed execution does not establish the absence of vulnerabilities.

The PRNG seed, algorithm, parent seed, selected candidates, options, application
version and fixture source fingerprint are recorded. Random capabilities and
request IDs remain independent of the deterministic ordering. The PRNG is not a
security mechanism. Reports contain no job capabilities, cookies, session state,
raw response bodies or arbitrary user-provided targets/credentials.

JSON is schema- and consistency-checked before save/read. JSON and escaped,
script-free HTML are published together by renaming a private temporary directory.
Existing report IDs are not overwritten; traversal and symlinked paths are rejected.
POSIX directories/files use owner-only modes; Windows access follows the parent
user-data ACL and still requires platform validation before distribution.

Exit status: 0 means execution completed (including an expected reproduced finding),
2 means incomplete/failed, 64 means invalid options, 130 means cancelled. Inspect
the result totals for findings instead of interpreting exit 0 as a safe target.

各コマンドは専用サンプルを一時ポートで起動し、検証後に終了します。正常版・修正版は違反の
再現なし、問題を入れた版では既知の4件を再現します。JSONと日英HTMLを非公開保存し、
HTMLを直接開いて結果・証拠を参照できます。取消・回数上限・期限切れは実行完了と区別します。

The CLI and desktop workspace are available starting with 2.0.0, including
in-app results, evidence, HTML reports and illustrated guides.
2.0.0からCLIとアプリ画面の両方で実行・取消・結果/証拠/HTML表示と日英教材を利用できます。

## Application workspace / アプリ画面

Open **Sample verification** in the workspace, or use its browser-install-free
shortcut on the setup screen. Start/cancel, inspect matching evidence by selecting
a result row, and view the saved HTML report inside the workspace. The contextual
manual drawer opens the illustrated verifier guide without discarding inputs.
The API is protected by numeric loopback/Host/Origin checks, a private HttpOnly
SameSite session and per-session job ownership. One active job is allowed per
backend. No job capability or local file path is returned in job status.

`npm run verifier:verify-ui` checks JA/EN baseline/changed/fixed, embedded report,
input retention and three desktop viewport sizes. This optional integration check
requires the source edition's Playwright Chromium. Unit tests require no browser.

## Development: static route attribution / 開発中の静的対応付け

The development branch adds individual SAST finding IDs, raw-source SHA-256,
UTF-16 source spans and bounded file-local Express AST route candidates. Existing
rule IDs remain compatible. Shared handlers are ambiguous; unsupported or dynamic
registrations stay unavailable. Static candidates never authorize execution or
prove runtime reachability. The dedicated GUI/CLI source-binding sample checks a separately authorized exact route before sends and after successful responses. Arbitrary-application selection, loaded-code attestation and ZAP integration remain incomplete. This feature is absent from the published 2.0.0 installers.
See the [illustrated source-edition guide](../../docs/training/SAST-MAPPING.md).

開発ブランチでは、個別検出ID・ソースハッシュ・正確な位置と、同一ファイル内の
Expressルート候補を追加しています。共有ハンドラーは複数候補、動的・未対応構文は
解析不能として表示します。実行許可・実行時の到達証拠には使いません。
専用サンプルは画面/CLIからソースと許可済みの完全一致ルートを照合して試行できます。任意アプリの選択・起動中コードの同一性確認・ZAPは未完成で、公開済み2.0.0の配布版には含まれません。
[ソース版の画像付きガイド](../../docs/training/SAST-MAPPING.ja.md)を参照してください。

## 3.0.0 source and passive evidence

`typed/domain` defines immutable source/ZAP contracts and correlation rules, `typed/application` composes source-guarded trials, and `typed/adapters` owns bounded HTTP, filesystem, API, installation and process lifecycles. `typed/cli/arguments.ts` validates CLI inputs before side effects. Generated JavaScript is not tracked.

GUI and CLI support the shipped source sample and an explicitly authorized, anonymous numeric-loopback HTTP JSON target with one literal GET/POST route. Source is never loaded. Results save privately under `artifacts/private/source-verifier`. Optional owned ZAP sessions contribute per-message passive evidence without proving SAST reachability or VEX status. Source changes invalidate evidence, including during passive waits. See the [bilingual guide](../../docs/training/SAST-MAPPING.md) for exact limits, commands and supported syntax.

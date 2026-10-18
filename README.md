# Web Security Hub 

[日本語の README](README.ja.md)

Web Security Hub is a locally run web-security assessment and form-regression testing tool aligned with OWASP risk categories. Test-case values are generated using deterministic, rule-based logic. An optional AI review adapter can review displayed SAST findings after explicit user authorization; it is not part of test-case generation or scanning.


## Download the application

| Platform | Installer | Status |
|---|---|---|
| macOS / Apple Silicon | [Download DMG](https://github.com/masahiroid/web-security-hub/releases/download/desktop-v2.0.0/Web-Security-Hub_2.0.0_macos_arm64.dmg) | Developer ID signed and Apple notarized |
| Windows / x64 | [Download setup](https://github.com/masahiroid/web-security-hub/releases/download/desktop-v2.0.0/Web-Security-Hub_2.0.0_windows_x64_setup.exe) | Unsigned |

[Release files and SHA-256 checksums](https://github.com/masahiroid/web-security-hub/releases/tag/desktop-v2.0.0). Use the source edition on Intel Macs or Linux. Windows installer operation was verified in a Windows CI environment.

## Desktop and double-click startup

See [desktop usage and setup](docs/desktop/README.md). Source launchers prepare the environment and open the setup screen; existing CLI commands remain available. Tauri source builds and native build workflows are also available.

## Illustrated training and hands-on course

Start with the [illustrated bilingual course](docs/training/README.md). Includes a local sample site, changed/fixed comparisons, instructor guides, and repeatable capture/verification commands. The About tab links to the browser edition.

## Documentation

- [User manual](docs/USER_MANUAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Functional specification](docs/SPECIFICATION.md)
- [Operations and security procedure](docs/OPERATIONS.md)
- [Localization guide](docs/LOCALIZATION.md)

## Start the application

```sh
npm install
npx playwright install chromium
npm start
```

Open `http://localhost:4173`.

## Capabilities

- **Hybrid DAST** — Playwright uses a real browser to crawl SPAs, authenticated pages, and JSON scenarios, and collects same-origin traffic. When ZAP is enabled, the traffic is replayed through the ZAP proxy so its existing Passive and Active Scan Rules can be used. Confirmation that you are authorized to test the target is required.
- **Playwright scenario recorder** — Opens a local visible browser after configured login and turns authorized interactions into a reviewable saved scenario for test generation, replay, and DAST. Passwords are never recorded; other input values require an explicit opt-in.
- **Static analysis (SAST)** — Scans a selected local source tree for dynamic code execution, command-execution APIs, SQL string concatenation, possible secrets, and disabled TLS verification. `node_modules`, `.git`, and build outputs are excluded.
- **Form and regression test-case generation** — Discovers forms from the same crawl and authenticated scenarios, then produces pairwise combinations of valid, boundary, and invalid values based on HTML constraints. It exports Playwright specs, YAML, and HTML reports.
- **Test-case management foundation** — Standard variables (`site.config.json`) and secret variables (`.env`, `SECRET_<NAME>`) usable as `{{NAME}}` tokens in scenario steps; reusable shared step groups (`sites/<id>/shared-steps.json`) referenced via a `useSharedStep` step; data-driven scenario execution from a CSV data set (`sites/<id>/data/<name>.csv`), running the same scenario once per row; and `folder`/`labels` metadata for organizing sites. Available via `core/scenario/*` and the `/api/sites/:id/{variables,shared-steps,data-sets}` endpoints; UI wiring is not yet built.
- **Extended scenario steps** — `back`/`forward`/`reload` navigation, `uncheck`, `setFile` (upload, confined to `sites/<id>/fixtures/`) and `download` (saved to `sites/<id>/downloads/`), plus `branch` (if/else on element existence/visibility/text) and `loop` (repeat N times), all normalized/validated in `core/scenario/siteScenario.js` and executed by the single shared `core/scenario/stepExecutor.js` used by both DAST scenario replay and test-case generation. The same behavior is inlined into every generated `generated.spec.ts` so replayed specs match live execution.
- **Cross-browser and device emulation** — `site.config.json`'s `browser.engine` selects Chromium, Firefox, or WebKit (all three are installed by `npm install`); `browser.device` applies a Playwright device descriptor (e.g. `"iPhone 14"`) for viewport/UA emulation; `browser.clientCert` configures a client TLS certificate (passphrase via `.env` `SECRET_CLIENT_CERT_PASSPHRASE`).
- **Saved auth sessions (for SSO/Google-login apps)** — `core/scenario/authSession.js` opens a visible browser for a human to log in by hand (we deliberately never automate a third-party identity provider's own login form), then saves the resulting cookies/localStorage (`sites/<id>/auth/storageState.json`) so later crawls and explorations start already signed in. Routes: `POST /api/auth-session/{start,stop,cancel}`.
- **Exploratory crawler** — `core/crawler/explorer.js` follows same-origin links and clicks non-form, non-destructive-looking controls (buttons, tabs, dropdown togglers) one at a time in an isolated throwaway tab so nothing compounds across clicks, screenshotting the resulting state to build a map of reachable screens. Anything inside a `<form>`, or whose label matches a destructive-keyword list (submit/delete/logout/purchase/... in Japanese and English), is reported as skipped rather than clicked — this is coverage exploration, not a replacement for the dedicated form-testing/security-scanning pipeline, and it does not submit forms. Run via `GET /api/sites/:id/explore/run` (SSE); results at `/api/sites/:id/explore-sessions/:sessionId/explore-report.html`.
- **Self-healing locators** — `core/scenario/locatorStrategy.js` saves a structural "heal hint" (tag, id, data-testid, name, role, aria-label, placeholder, text, classes — no field values) alongside every recorded click/fill/check/select step. At execution time (`core/scenario/stepExecutor.js`), if a step's primary selector doesn't resolve within a few seconds, it tries selectors derived from the heal hint, then a similarity scan of same-tag elements on the live page, scored by how many of those attributes still match. Healing is never silent: every healed step logs `🩹 セレクタ自動修復 <old> -> <new>` and is collected into a `healEvents` array so a run's results (and, eventually, its report) show exactly which selectors no longer match, rather than the test silently drifting from what was recorded.
- **AI assertions (opt-in)** — An `aiAssert` scenario step checks a natural-language assertion against a text-only page snapshot (visible text and interactive elements’ accessible names/roles). It uses the optional external AI CLI adapter in `core/ai/assertionAdapter.js`; this may transmit page text to the configured AI service. Disabled by default: enable it per site with `ai.assertionsEnabled: true` in `site.config.json`. Other step types remain deterministic. A failed assertion fails the step with its stated reason; results are logged and collected in `aiAssertions`.
- **Mobile (iOS/Android) via Appium** — `site.config.json`'s `platform: "ios"|"android"` plus a `mobile` block (`deviceName`, `platformVersion`, `app` or `bundleId`) switches a site from the Playwright pipeline to `core/mobile/*`: `appiumServer.js` starts a local Appium server (this project's own `node_modules/.bin/appium` — no separate global install), `mobileSession.js` opens a WebdriverIO session against it (XCUITest for iOS, UiAutomator2 for Android — you still need Xcode or the Android SDK + a running simulator/emulator/device on the host), and `mobileStepExecutor.js` runs a smaller, WebdriverIO-native step language (`tap`, `fill`, `wait`, `waitForSelector`, `swipe`, `screenshot`, `loop`) defined under `mobileScenario.steps`. Run via `GET /api/sites/:id/mobile/run` (SSE). Verified end to end against a real iOS 27 Simulator (iPhone 17) in this session: server boot, simulator boot, WebDriverAgent handshake, session creation, a scenario step, and clean teardown all worked. Scope is intentionally smaller than the web step language for now — no self-healing, no AI assertions, no branch, no Android verification yet (no Android emulator was available to test against in this session, only the driver/capability code).

Every finding includes severity, an OWASP category, evidence, and remediation guidance. Automated findings support human review; they do not prove a vulnerability or guarantee security.

To passively assess an authorized target from the CLI:

```sh
npm run dynamic-scan -- https://staging.example.com/
```

## Local sample verification (2.0.0)

Run an isolated fixture campaign with private JSON/HTML reports. Run `npm run verifier:run -- --mode changed` after installing source dependencies. See the [verifier guide](core/verifier/README.md) for baseline/fixed modes, limits and cancellation. The desktop Sample verification workspace also supports execution, cancellation, evidence inspection and HTML reports. See the [illustrated hands-on guide](docs/training/VERIFIER.md). Available starting with 2.0.0.

## ZAP integration

ZAP remains the mature scan engine rather than being reimplemented here. This application handles authenticated exploration and scenario replay with Playwright; ZAP evaluates the collected traffic with its established rules.

Start local ZAP (its API is exposed only on localhost):

```sh
docker compose -f docker-compose.zap.yml up -d
```

In the interface, select **Scan with ZAP rules**, verify connectivity, then run the assessment. Run active scans only on a staging environment for which you have explicit authorization. Stop ZAP when finished:

```sh
docker compose -f docker-compose.zap.yml down
```

`scenarioJson` accepts login data and `goto`, `click`, `fill`, `check`, `select`, and `wait` steps. This data is not persisted or included in scan results.

## Combining test cases and vulnerability assessments

The **Test Case Generation** tab uses the same start URL, authentication, and scenario as the dynamic-assessment tab. First model a business flow as a scenario and generate normal, boundary, and invalid form tests. Then crawl the same flow with Playwright and ZAP. This brings functionality that cannot be reached through ordinary navigation into both regression tests and security assessment.

## Safe operation

Limit all targets to systems you own or environments for which you have explicit authorization. Passive assessment does not submit forms or attempt intrusion. Test-case execution and ZAP Active Scan do send requests to the target. The product does not include authentication-bypass or denial-of-service testing. Before testing production, validate impact with a small crawl scope and page limit in staging.

## License and copyright

Copyright 2024–2026 Masahiro NAKATSUGAWA.

Web Security Hub is distributed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for copyright and attribution information.

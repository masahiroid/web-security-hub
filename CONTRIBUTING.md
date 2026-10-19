# Contributing to Web Security Hub

Thank you for your interest in contributing. Bug reports, enhancement requests, documentation fixes and pull requests are welcome.

## Reporting bugs and requesting enhancements

Use GitHub Issues: https://github.com/masahiroid/web-security-hub/issues

Please include the version, your OS, the steps to reproduce, and what you expected to happen. Do not report security vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md) instead.

## Contribution process

1. Fork the repository and create a branch from `main`.
2. Make your change, keeping it focused on one topic.
3. Run the tests (see below) and make sure they pass.
4. Open a pull request that explains what changed and why. Link the related issue if there is one.
5. The maintainer reviews the pull request. Changes may be requested before it is merged.

## Requirements for acceptable contributions

- Use only targets you own or are explicitly authorized to test in examples, fixtures and documentation.
- `npm run lint`, `npm run typecheck`, `npm test`, both dependency audits and `npm run release:check` pass. Lint warnings are errors; fix findings instead of adding blanket suppressions.
- New features and bug fixes add or update tests under `test/` that cover the changed behavior and its failure cases.
- Follow the existing code style and structure (see `docs/ARCHITECTURE.md`).
- Update the relevant documentation under `docs/` and the README when behavior changes. Keep English and Japanese documents consistent where both exist.
- Add a short entry to `CHANGELOG.md` for user-visible changes.
- Do not commit secrets, private reports or local signing configuration.
- Contributions are accepted under the repository's license (Apache-2.0).

## Development setup

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm audit --audit-level=moderate
npm audit --audit-level=moderate --prefix desktop/runtime
npm run release:check
```

Use Node.js 22.19.0 or later and npm. `npm run build:verifier` builds the strict TypeScript verifier and UI; it uses the FLOSS TypeScript compiler. The source application can be built and tested with FLOSS tools; optional native installer packaging additionally needs the platform prerequisites in `docs/desktop/README.md`. Signing/notarization are distribution steps, not required to build the source application.

`npm test` uses the FLOSS Node.js test runner and `node:assert/strict`. Assertions remain enabled during tests. Add tests for major features, boundary/invalid inputs, authorization and cancellation; add a regression test when fixing a bug. Existing tests exercise scenarios, mobile command dispatch, replay credentials, verifier scope/capabilities, HTTP transport, evidence correlation and installer privacy. Most-branch coverage has not been measured; passing tests do not claim full coverage or real-device acceptance. The WebdriverIO loopback protocol test does not replace Appium device testing.

The Rust dependency graph is also audited with `cargo audit --file src-tauri/Cargo.lock`. The Linux CI verifies the optimized glib soundness backport; its upstream provenance and replacement conditions are in `src-tauri/vendor/glib-0.18.5/PATCH.md`.

The Quality and security workflow runs on pushes, pull requests and weekly; CodeQL analyzes JavaScript/TypeScript with security queries. Intentional vulnerable training fixtures are excluded from production static analysis. Release workflows run lint, type checking, tests, release-content checks and dependency audits. Before a major release, review CodeQL and secret-scanning alerts, run these checks on the exact release commit, triage every confirmed exploitable medium-or-higher finding and document fixed public CVE/GHSA identifiers in `CHANGELOG.md`. Publish human-readable release notes, a unique `desktop-vMAJOR.MINOR.PATCH` tag and HTTPS downloads; follow SemVer for compatibility changes. Critical vulnerabilities take immediate priority.

See `docs/OPERATIONS.md` and `docs/USER_MANUAL.md` for running the application.

---

# コントリビュートの手順（日本語）

バグ報告・機能要望は GitHub Issues へお願いします（脆弱性は SECURITY.md に従い非公開で報告してください）。Pull Request は `main` から作成したブランチで、1つの目的に絞って作成してください。

受け入れ条件：lint・型検査・テスト・両方の依存監査・release:checkが通ること。上記コマンドを実行し、警告も修正してください。新機能やバグ修正には、対応するテストを `test/` に追加すること。ドキュメント（`docs/`、README）と `CHANGELOG.md` を必要に応じて更新すること。許可された対象のみを例や fixture に使うこと。秘密情報・非公開レポート・署名設定をコミットしないこと。コントリビュートは Apache-2.0 ライセンスで受け入れられます。

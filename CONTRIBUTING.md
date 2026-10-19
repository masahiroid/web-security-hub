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
- `npm test` passes.
- New features and bug fixes add or update tests under `test/` that cover the changed behavior and its failure cases.
- Follow the existing code style and structure (see `docs/ARCHITECTURE.md`).
- Update the relevant documentation under `docs/` and the README when behavior changes. Keep English and Japanese documents consistent where both exist.
- Add a short entry to `CHANGELOG.md` for user-visible changes.
- Do not commit secrets, private reports or local signing configuration.
- Contributions are accepted under the repository's license (Apache-2.0).

## Development setup

```bash
npm install
npm test
```

See `docs/OPERATIONS.md` and `docs/USER_MANUAL.md` for running the application.

---

# コントリビュートの手順（日本語）

バグ報告・機能要望は GitHub Issues へお願いします（脆弱性は SECURITY.md に従い非公開で報告してください）。Pull Request は `main` から作成したブランチで、1つの目的に絞って作成してください。

受け入れ条件：`npm test` が通ること。新機能やバグ修正には、対応するテストを `test/` に追加すること。ドキュメント（`docs/`、README）と `CHANGELOG.md` を必要に応じて更新すること。許可された対象のみを例や fixture に使うこと。秘密情報・非公開レポート・署名設定をコミットしないこと。コントリビュートは Apache-2.0 ライセンスで受け入れられます。

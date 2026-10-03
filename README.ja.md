# Web Security Hub — 日本語

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23122939.svg)](https://doi.org/10.5281/zenodo.23122939)

[English README](README.md)

OWASP のリスク分類を基準にした、ローカル実行の Web セキュリティ診断・フォーム回帰テストツールです。テストケースの値生成はルールベースで行います。表示中の SAST 結果を明示許可のうえでレビューする任意のローカル Claude Code アダプターを備えますが、テストケース生成やスキャン本体では使用しません。

## ドキュメント

- [利用マニュアル](docs/ja/USER_MANUAL.md)
- [設計書](docs/ja/ARCHITECTURE.md)
- [機能仕様書](docs/ja/SPECIFICATION.md)
- [運用・安全管理手順](docs/ja/OPERATIONS.md)
- [多言語対応ガイド](docs/ja/LOCALIZATION.md)

## 起動

```sh
npm install
npx playwright install chromium
npm start
```

`http://localhost:4173` を開きます。

## 機能

- **ハイブリッド DAST** — Playwright が実ブラウザーで SPA・ログイン後画面・JSON シナリオを巡回し、同一オリジンの通信を収集します。ZAP を有効にすると、その通信を ZAP プロキシへ送って既存の Passive / Active Scan Rules も実行します。診断許可の確認が必須です。
- **Playwright シナリオ記録** — 設定済みログイン後にローカルの可視ブラウザーを開き、許可済みの操作をテストケース生成・再実行・DAST で共用する確認可能な保存シナリオへ変換します。パスワードは記録せず、その他の入力値も明示選択が必要です。
- **静的解析 (SAST)** — 指定したローカルソースツリーを解析し、動的コード実行、コマンド実行 API、SQL 文字列連結、秘密情報、TLS 検証無効化の兆候を検出します。`node_modules`、`.git`、ビルド成果物は除外します。
- **フォーム・回帰テストケース作成** — 同じ巡回・ログインシナリオからフォームを発見し、HTML 制約に基づく正常・境界・異常値をペアワイズで組み合わせます。Playwright spec、YAML、HTML レポートを出力します。

各検出結果には重要度、OWASP 分類、根拠、修正案を表示します。自動検出はレビューの補助であり、脆弱性の確定や安全性の保証ではありません。

CLI で許可済みの対象をパッシブ診断する場合:

```sh
npm run dynamic-scan -- https://staging.example.com/
```

## ZAP との統合

ZAP は本ツールが再実装しない成熟した検査エンジンです。本ツールは Playwright による認証済み探索・シナリオ再生を担当し、ZAP は収集済み通信への既存ルールによる検査を担当します。

ローカル ZAP を起動します（API は localhost にだけ公開されます）。

```sh
docker compose -f docker-compose.zap.yml up -d
```

画面で「ZAP の既存ルールで検査する」を選び、接続確認後に診断します。アクティブ検査は明示的な許可を得たステージング環境にのみ実行してください。終了時は `docker compose -f docker-compose.zap.yml down` を実行します。

`scenarioJson` にはログイン情報と `goto` / `click` / `fill` / `check` / `select` / `wait` ステップを渡せます。情報は保存せず、スキャン結果にも含めません。

## テストケースと脆弱性診断の併用

「テストケース作成」タブは、動的診断タブと同じ開始 URL・認証・シナリオを使用します。まず業務フローをシナリオ化してフォームの正常／境界／異常系を生成し、その後に同じフローを Playwright＋ZAP で巡回すると、画面から到達できない機能も回帰テストと脆弱性検査の両方に含められます。

## 安全な運用

診断対象は必ず自組織または明示的に許可を得た環境に限定してください。パッシブ診断はフォーム送信や侵入試行を行いませんが、テストケース実行と ZAP Active Scan は対象へリクエストを送信します。認証回避や DoS を目的とした検査は含みません。本番環境で実行する前に、ステージング環境で巡回範囲とページ数を小さく設定して影響を確認してください。

## ライセンスと著作権

Copyright 2024–2026 Masahiro NAKATSUGAWA.

Web Security Hub は [Apache License 2.0](LICENSE) の下で配布します。著作権および帰属情報は [NOTICE](NOTICE) を参照してください。

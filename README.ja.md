# Web Security Hub — 日本語

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
- **テストケース管理の基盤** — `site.config.json` の標準変数と `.env`（`SECRET_<NAME>`）のシークレット変数をシナリオステップ内で `{{NAME}}` トークンとして利用できます。`sites/<id>/shared-steps.json` に保存する共有ステップ群は `useSharedStep` ステップから参照でき、`sites/<id>/data/<name>.csv` のデータセットを指定するとシナリオを行ごとに繰り返すデータ駆動テストが行えます。サイトの整理用に `folder` / `labels` メタデータも追加しました。`core/scenario/*` と `/api/sites/:id/{variables,shared-steps,data-sets}` から利用できますが、UI 側の組み込みは未着手です。
- **シナリオステップの拡張** — `back`/`forward`/`reload` によるナビゲーション、`uncheck`、`setFile`（`sites/<id>/fixtures/` 配下に限定したアップロード）、`download`（`sites/<id>/downloads/` へ保存）に加え、`branch`（要素の有無・表示・テキストによるif/else分岐）と `loop`（指定回数の繰り返し）に対応しました。`core/scenario/siteScenario.js` で検証し、DAST シナリオ再生とテストケース生成の両方が共通の `core/scenario/stepExecutor.js` を通じて実行するため挙動が一致します。生成される `generated.spec.ts` にも同じロジックをインライン化しています。
- **クロスブラウザ・端末エミュレーション** — `site.config.json` の `browser.engine` で Chromium/Firefox/WebKit を切り替え（`npm install` で3エンジンとも導入）、`browser.device` で Playwright のデバイス定義（例: `"iPhone 14"`）によるビューポート/UA エミュレーションを適用できます。`browser.clientCert` でクライアント証明書も設定可能（パスフレーズは `.env` の `SECRET_CLIENT_CERT_PASSPHRASE`）。
- **認証セッションの保存（SSO・Google認証アプリ向け）** — `core/scenario/authSession.js` が可視ブラウザーを開き、人間が手動でログインします（Google等サードパーティの認証画面自体は意図的に自動操作しません）。ログイン後のCookie/localStorageを`sites/<id>/auth/storageState.json`に保存し、以降のクロール・探索はログイン済み状態から開始できます。ルート: `POST /api/auth-session/{start,stop,cancel}`。
- **探索的クロール** — `core/crawler/explorer.js` が同一オリジンのリンクを辿りつつ、フォーム外にある「破壊的操作らしくない」コントロール（ボタン・タブ・ドロップダウン等）を1つずつ独立した使い捨てタブでクリックし、状態が積み重ならないようにしながらスクリーンショットで画面遷移を地図化します。`<form>`内の要素、および送信/削除/ログアウト/購入等の日英キーワードにラベルが一致する要素はクリックせず「スキップ」として報告します（フォーム送信は一切行いません）。既存のフォームテスト・セキュリティ診断パイプラインの代替ではなく、網羅的な画面探索の補助です。実行: `GET /api/sites/:id/explore/run`（SSE）。結果: `/api/sites/:id/explore-sessions/:sessionId/explore-report.html`。
- **セルフヒーリング（ロケータ自動修復）** — `core/scenario/locatorStrategy.js` が、記録された各click/fill/check/selectステップに構造的な「修復ヒント」（tag・id・data-testid・name・role・aria-label・placeholder・text・class。値そのものは含まない）を保存します。実行時（`core/scenario/stepExecutor.js`）、主セレクタが数秒以内に見つからない場合、修復ヒントから導いたセレクタ候補を順に試し、それでも見つからなければ同じタグを持つ現在のページ上の要素を修復ヒントとの一致度でスコアリングして最も近いものを採用します。修復は無言では行わず、修復の都度 `🩹 セレクタ自動修復 <旧> -> <新>` をログ出力し、`healEvents`配列に記録します。どのセレクタが実際に効かなくなったかを実行結果（将来的にはレポート）で可視化し、テストが記録内容から静かにズレていくのを防ぎます。
- **AIアサーション（任意機能）** — `aiAssert`シナリオステップは、自然言語のアサーション（「ダッシュボードが表示されている」「パスワードに関するエラーが見える」）を、ページのテキストのみのスナップショット（表示テキストと操作可能要素のアクセシブルネーム/role。スクリーンショット・画像呼び出しはなし）と照合します。実装は`core/ai/assertionAdapter.js`で、既存のSASTレビュー機能と同じ「ローカルClaude Code CLIを使い、呼び出し前に`ANTHROPIC_API_KEY`を除去してAPI課金を避け、運用者のローカルサブスクリプションログインを使う」というアダプタ構成を踏襲しています。既定では無効で、サイト単位のオプトインです: `site.config.json`の`ai.assertionsEnabled: true`を設定してください——他の全ステップ種別は決定論的・ルールベースですが、これだけはアサーションごとに外部プロセスを呼び出すため、自動有効化ではなく明示的で永続的なオプトインが必要と判断しました。アサーション失敗時はそのステップを失敗させ、モデルが述べた理由を添えます。実行の都度 `🤖 AIアサーション成功/失敗` をログに残し、`aiAssertions`配列に記録します。

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

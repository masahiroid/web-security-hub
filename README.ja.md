# Web Security Hub — 日本語

[![Release](https://img.shields.io/github/v/release/masahiroid/web-security-hub?filter=desktop-v*&label=release)](https://github.com/masahiroid/web-security-hub/releases/latest)
[![Windows installer CI](https://github.com/masahiroid/web-security-hub/actions/workflows/windows-installer.yml/badge.svg?branch=main)](https://github.com/masahiroid/web-security-hub/actions/workflows/windows-installer.yml?query=branch%3Amain)
[![License: Apache-2.0](https://img.shields.io/github/license/masahiroid/web-security-hub)](LICENSE)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.23122939-blue)](https://doi.org/10.5281/zenodo.23122939)

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15681/badge)](https://www.bestpractices.dev/projects/15681)
[![Website: TIP](https://img.shields.io/badge/website-TIP-0F766E)](https://tip.co.jp/web-security-hub/)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-2563EB)](CONTRIBUTING.md)

[![Release asset downloads](https://img.shields.io/github/downloads/masahiroid/web-security-hub/total?label=asset%20downloads)](https://github.com/masahiroid/web-security-hub/releases)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple)](https://github.com/masahiroid/web-security-hub/releases/latest)
[![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)](https://github.com/masahiroid/web-security-hub/releases/latest)
[![Documentation: English / Japanese](https://img.shields.io/badge/docs-English%20%2F%20Japanese-0F766E)](docs/training/README.ja.md)

[English README](README.md)

OWASP のリスク分類を基準にした、ローカル実行の Web セキュリティ診断・フォーム回帰テストツールです。テストケースの値生成はルールベースで行います。表示中の SAST 結果を明示許可のうえでレビューする任意のAIレビューアダプターを備えますが、テストケース生成やスキャン本体では使用しません。


## アプリのダウンロード

| OS | インストーラー | 状態 |
|---|---|---|
| macOS / Apple Silicon | [DMG をダウンロード](https://github.com/masahiroid/web-security-hub/releases/download/desktop-v4.0.0/Web-Security-Hub_4.0.0_macos_arm64.dmg) | Developer ID 署名・Apple 公証済み |
| Windows / x64 | [セットアップをダウンロード](https://github.com/masahiroid/web-security-hub/releases/download/desktop-v4.0.0/Web-Security-Hub_4.0.0_windows_x64_setup.exe) | 未署名 |

[配布ファイルと SHA-256](https://github.com/masahiroid/web-security-hub/releases/tag/desktop-v4.0.0)。macOS Intel / Linux はソース版をご利用ください。Windows 版は Windows の CI 環境でインストール後の操作を確認しています。

## デスクトップ版・ダブルクリック起動

[アプリ版と起動方法](docs/desktop/README.ja.md)。ソース版は macOS の `start.command`、Windows の `start.bat` から環境確認・必要な導入・開始画面へ進めます。従来の CLI も利用できます。Tauri のソースビルドにも対応しています。

## 画像付き研修・ハンズオン

初めての方は [日英の画像付きハンズオン](docs/training/README.ja.md) を参照してください。ローカルのサンプルサイト、変更・修正版の比較、講師用ガイド、再撮影・検証コマンドを同梱しています。起動後は「診断について」からブラウザー版も開けます。

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
- **AIアサーション（任意機能）** — `aiAssert`シナリオステップは、自然言語のアサーションをページのテキストスナップショット（表示テキストと操作要素のアクセシブルネーム／role）と照合します。`core/ai/assertionAdapter.js`の任意の外部AI CLIアダプターを使うため、設定されたAIサービスへページのテキストが送信される場合があります。既定では無効で、サイト単位で`site.config.json`の`ai.assertionsEnabled: true`を設定します。他のステップ種別は決定論的な処理です。アサーション失敗時は理由を添えてステップを失敗とし、結果をログと`aiAssertions`配列に記録します。
- **モバイル（iOS/Android）対応 — Appium経由** — `site.config.json`の`platform: "ios"|"android"`と`mobile`ブロック（`deviceName`・`platformVersion`・`app`または`bundleId`）を設定すると、Playwrightパイプラインの代わりに`core/mobile/*`が使われます。`appiumServer.js`がローカルのAppiumサーバーを起動し（このプロジェクト自身の`node_modules/.bin/appium`を使うため別途グローバルインストール不要）、`mobileSession.js`がWebdriverIOセッションをそこへ確立します（iOSはXCUITest、AndroidはUiAutomator2——ホスト側にXcodeまたはAndroid SDK＋起動中のシミュレータ/エミュレータ/実機は別途必要）。`mobileStepExecutor.js`が`mobileScenario.steps`で定義するWebdriverIOネイティブの小さめのステップ言語（`tap`・`fill`・`wait`・`waitForSelector`・`swipe`・`screenshot`・`loop`）を実行します。実行: `GET /api/sites/:id/mobile/run`（SSE）。このセッションで実機のiOS 27 Simulator（iPhone 17）に対してエンドツーエンドで検証済みです（サーバー起動→シミュレータ起動→WebDriverAgentハンドシェイク→セッション作成→ステップ実行→クリーンな終了まで）。Web版のステップ言語より意図的に小さいスコープです——セルフヒーリング・AIアサーション・条件分岐は未対応、Androidはこのセッションではエミュレータが用意できず未検証です（ドライバ・Capability構築のコードのみ）。

各検出結果には重要度、OWASP 分類、根拠、修正案を表示します。自動検出はレビューの補助であり、脆弱性の確定や安全性の保証ではありません。

CLI で許可済みの対象をパッシブ診断する場合:

```sh
npm run dynamic-scan -- https://staging.example.com/
```

## ローカルサンプル検証（2.0.0）

専用サンプルの一括検証と非公開JSON／HTMLレポートの保存が使えます。ソースの依存関係を導入後、`npm run verifier:run -- --mode changed`で実行できます。正常版・修正版、実行上限・取消については[検証機能ガイド](core/verifier/README.md)を参照してください。アプリの「サンプル検証」画面からも実行・取消・証拠確認・HTMLレポート表示ができます。[画像付きハンズオン](docs/training/VERIFIER.ja.md)を用意しています。2.0.0からの機能です。

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

開発ブランチでは、ソース版で[個別SAST検出IDと静的ルート候補](docs/training/SAST-MAPPING.ja.md)を確認できます。専用サンプルでは画面とCLIからソース・実行scopeを照合できます。任意アプリへの実行接続・ZAP連携は未完成で、公開済み2.0.0の配布版には含まれません。

## 4.0.0 遺伝的探索

3つの条件が同時にそろったときだけ違反になる架空のサンプルを探索します。遺伝的アルゴリズムが候補の選択・交叉・突然変異を世代ごとに行い、同じ候補を2回実行せず、別のセッションで独立に再実行して確認できたものだけを結果として数えます。任意の言語モデルで候補の一部を補えますが、初期状態では使わず、モデルなしでも探索は完結します。GUIで使えるのはこの端末のモデル（127.0.0.1）だけです。固定ルール・遺伝的アルゴリズム・モデル併用を、同じ試行上限と事前に固定したseedで比較できます。[画像付きガイド](docs/training/GENETIC.ja.md)を参照してください。結果は順位ではなく測定値です。どの方式も違反の発見を保証せず、有限の試行で見つからなくても安全の証明にはなりません。モデル接続はloopback上のllama.cppサーバーでのみ確認しており、外部サービスへの送信はコマンドラインだけで、実サービスでは試していません。

## 3.0.0のソース検証

SAST個別検出の解析、専用サンプル、明示許可したローカルJSON APIの検証、GUIからの任意ZAP導入に対応します。[画像付き操作ガイド](docs/training/SAST-MAPPING.ja.md)にprivate JSON/HTMLの参照方法と制限を記載しています。ソースだけの評価は調査中のままです。[依存関係の範囲](SECURITY.md)。

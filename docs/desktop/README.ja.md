# デスクトップ版とダブルクリック起動

[English](README.md)

## 利用方法

ビルド済みの macOS アプリは `.app` を開きます。Node.js の事前インストールは不要です。開始画面で保存先と診断ブラウザーをチェックし、不足があれば「必要なブラウザーをインストール」を押します。初回のブラウザーダウンロードにはインターネット接続が必要です。

ソース版では、展開したフォルダー内の次のファイルを起動してください。

| OS | 起動ファイル |
|---|---|
| macOS | `start.command` をダブルクリック |
| Windows | `start.bat` をダブルクリック |
| Linux | 実行可能な `start.sh`（ファイルマネージャーの設定によりターミナルで実行） |

ソース版は Node.js 22 以上と npm を確認し、不足する場合に公式の固定バージョンを SHA-256 で検証して `.runtime/` に導入します。依存パッケージはロックファイルから準備します。管理者権限やグローバル Node.js の変更は不要です。初回の進捗と失敗理由はターミナル、その後のブラウザー導入は開始画面に表示されます。Windows の PowerShell 実行ポリシー指定は起動プロセス内だけに適用し、システムのポリシーを変更しません。

開始画面の「アプリ版の操作ガイド」に、コマンドを使わない演習手順をまとめています。アプリ内で開く画像付き教材も、起動・切替・初期化がボタン操作の版になります。「ハンズオン環境を開始」で日英の練習サイトを準備し、基本版・変更版・修正版もボタンで切り替えます。SAST の教材ソースも開始画面のリンクからパス入力済みで開けます。

![Desktop start screen](../../desktop/welcome/images/welcome-ja.png)

## CLI も引き続き使えます

```sh
npm run doctor        # 環境チェック（JSON、準備不足なら終了コード1）
npm run setup         # Chromium 導入後、再チェック
npm run launch        # 開始画面付き起動
npm start             # 従来のサーバー起動（4173）
```

既存の `dynamic-scan`、`autoflow`、`replay`、`training:*` も残しています。CLI の `npm start` は従来どおりリポジトリ内へ保存します。

## 保存先と終了

開始画面付き起動は利用者専用のデータ領域にサイト設定・認証情報・実行結果を保存します。ネイティブ版とソース版は別の標準保存先を使います。実際の場所は開始画面に表示します。`WEB_SECURITY_HUB_DATA_DIR` を指定すると保存先を変更できます。

- macOS ネイティブ版: `~/Library/Application Support/io.github.masahirocom.web-security-hub/`
- macOS ソース版: `~/Library/Application Support/Web Security Hub/`
- Windows / Linux: 各 OS の利用者データ領域。ネイティブ版は Tauri の app data directory を使用。

既存のリポジトリ内データは自動移動しません。コピーする場合はサーバーを終了し、サイトの `.env` も含めて `sites/` を新しい保存先へコピーしてください。既存ベースラインはブラウザーや OS が変わると再確認が必要です。

ネイティブ版はアプリ終了時に内部サーバーと子プロセスを終了します。ソース版はターミナルで Ctrl+C を押します。ローカル管理 API はランダムなセッション認証、Host / Origin 確認を行い、外部ネットワークへ公開しません。実際の診断対象ページにはネイティブのコマンド実行権限を与えていません。

## 開発と検証

```sh
npm ci --ignore-scripts
npm run desktop:prepare
npm run desktop:dev
npm run desktop:build
npm run desktop:verify
```

ビルドには Rust と [Tauri の OS 別前提条件](https://v2.tauri.app/start/prerequisites/) が必要です。`desktop:prepare` は対応する OS / CPU の公式 Node.js と実行用依存パッケージを同梱用に準備します。各 OS 向けビルドは対応するネイティブ CI ランナーで行います。

`desktop:verify` は空の一時データ領域で、未導入検出→画面からの Chromium 導入→研修起動→静的解析→ユーザーデータ領域で生成・編集・ベースライン・再実行を検証します。ブラウザーのダウンロードが必要で、研修用4180番ポートを使用します。証跡は `artifacts/desktop/` に保存します。

Windows / Linux のビルド定義はありますが、この macOS セッションでそれらの実機動作を検証したわけではありません。Linux では Chromium の OS ライブラリが別途必要な場合があります。ZAP、モバイル、AI、他ブラウザーは別途環境準備・検証が必要です。

## 配布版の範囲

初版のネイティブ配布は Web 自動化・診断と教材を対象にし、Appium / WebdriverIO は同梱しません。モバイルはソース／CLI 版で利用します。配布用依存関係は `desktop/runtime/package{,-lock}.json` で独立して固定しています。ソース版のモバイル依存には監査指摘が残っており、一般配布前の課題として分離しています。

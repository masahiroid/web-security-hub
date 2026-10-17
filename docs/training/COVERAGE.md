# 機能対応 / Feature coverage

対象 / Target: Web Security Hub 1.3.0. 「実装済み」はソースに存在する機能であり、すべての実行環境で検証済みという意味ではありません。Implemented does not mean verified on every platform.

| 機能 / Feature | 操作経路 / Entry point | 教材 / Course coverage |
|---|---|---|
| サイト・認証 / Site and credentials | サイト管理 / Sites | T03、日英実画面 / bilingual screenshots |
| 操作記録 / Interaction recording | サイト管理 / Sites | T04、記録手順と JSON 代替 / recording instructions and JSON fallback |
| フォーム生成 / Form generation | テストケース作成 / Test Cases | T05、実行済み / executed |
| 編集・再実行・画像比較 / Edit, replay, visual diff | 再実行 / Replay | T06–T08、基本・無変更・変更・修正 / baseline, unchanged, changed, fixed |
| DAST | 動的脆弱性診断 / Dynamic Scan | T09、ZAP 無しで実行 / executed without ZAP |
| SAST と成果物 / SAST and artifacts | 静的解析 / Static Analysis | T10、before/after 例 / fixtures |
| ZAP Passive / Active | Dynamic Scan / Replay | 既存マニュアル参照、今回の自動検証外 / existing manual; not validated in this course |
| 画面探索 / Exploration | `GET /api/sites/:id/explore/run` (SSE) | API 機能。UI タブなし / API only, no UI tab |
| 手動認証セッション / Manual auth session | `/api/auth-session/{start,stop,cancel}` | API、デスクトップ環境が必要 / API, desktop required |
| 変数・共有ステップ・CSV / Variables, shared steps, CSV | `site.config.json` and `/api/sites/:id/{variables,shared-steps,data-sets}` | API / configuration; UI integration pending |
| ブラウザー・端末 / Browser and device | `browser.engine`, `browser.device` | Configuration; Chromium core course only |
| 自動修復 / Locator healing | scenario `healHint` and execution logs | 応用教材候補 / extension candidate |
| AI assertion / SAST AI review | opt-in configuration / Static Analysis | optional external CLI; not called by course automation |
| iOS / Android | configuration and `/api/sites/:id/mobile/run` | 環境準備を伴う別コース / separate course with platform prerequisites |


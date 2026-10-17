'use strict';
// Adapt the shared illustrated course for managed startup, keeping source/CLI
// documentation intact. All inserted actions are fixed, authenticated local APIs.
function renderDesktopCourse(html, { lang, origin, port }) {
  const ja = lang === 'ja';
  const labels = ja ? { baseline:'基本版に切り替える',changed:'変更版に切り替える',fixed:'修正版に切り替える',reset:'サンプルを初期化' } : { baseline:'Switch to baseline',changed:'Switch to changed',fixed:'Switch to fixed',reset:'Reset sample' };
  const button = mode => `<button type="button" data-training-mode="${mode}">${labels[mode]}</button>`;
  const nav = `<p><a href="/welcome">← ホーム / Home</a> · <a href="/desktop/guide${ja ? '.ja' : ''}.html">${ja ? 'アプリ版の操作ガイド' : 'Desktop app guide'}</a></p><p id="courseStatus" role="status" aria-live="polite"></p>`;
  html = html.replaceAll('Hub runs on port 4173', `Hub runs on port ${port}`).replaceAll('4173 と 4180', `${port} と 4180`).replaceAll('ports 4173 and 4180', `ports ${port} and 4180`);
  html = html.replaceAll('http://127.0.0.1:4173', origin).replaceAll('http://localhost:4173', origin).replaceAll('<strong>4173</strong>', `<strong>${port}</strong>`);
  const start = ja
    ? '<h2>T01 アプリから研修を始める</h2><p>このアプリには実行環境が同梱されています。ホームで診断ブラウザーの準備が完了したら、下のボタンを押してください。サンプルサイトを起動し、日英の研修設定を用意します。ターミナル操作は不要です。</p><p><button type="button" data-start-training>ハンズオン環境を開始</button> · <a href="/welcome">環境チェックに戻る</a></p><p>設定を初期化する場合は、ホームの確認欄と「研修設定も初期化」を使います。過去の実行結果は残ります。</p>'
    : '<h2>T01 Start training from the app</h2><p>The app includes its runtime. Once the automation browser is ready on Home, use the button below to start the sample and prepare both training configurations. No terminal commands are needed.</p><p><button type="button" data-start-training>Start hands-on environment</button> · <a href="/welcome">Return to environment check</a></p><p>To reset training configuration, use the confirmation and Reset training configuration on Home. Previous results remain.</p>';
  html = html.replace(/<h2>T01\b[\s\S]*?(?=<h2>T02\b)/, start);
  html = html.replace('Node.js 22 以上と npm を準備してください。','').replace('コマンドはすべてリポジトリのルートで実行します。','').replace('Requirements: Node.js 22 or later and npm. ','').replace('Run all commands from the repository root.','');
  for (const mode of ['baseline','changed','fixed','reset']) {
    const command = `npm run training:mode -- ${mode}`;
    html = html.split(`<pre><code class="language-sh">${command}\n</code></pre>`).join(`<p>${button(mode)}</p>`);
    html = html.split(`<code>${command}</code>`).join(button(mode));
  }
  const analysis = ja
    ? `<h2>T10 静的解析を実行する</h2><p><a href="/?trainingScan=before">修正前の教材ソースを静的解析画面で開く</a>を選ぶと、パスが入力済みで開きます。「静的解析を開始」を押してください。</p><p>期待するルールは <code>SAST-DANGEROUS-EVAL</code> と <code>SAST-SQL-CONCAT</code> です。これらのソースは教材専用で、サンプルサーバーでは実行されません。</p><p><img src="images/ja/13-sast-before.png" alt="修正前の静的解析結果"></p><p>次に <a href="/?trainingScan=after">修正後の教材ソースを開く</a>から解析し、検出が 0 になることを確認します。検出ゼロがアプリ全体の安全性を保証するわけではありません。</p><p><img src="images/ja/13-sast-after.png" alt="修正後の静的解析結果"></p>`
    : `<h2>T10 Run static analysis</h2><p><a href="/?trainingScan=before">Open the before-fix fixture in Static Analysis</a>. The source path is already filled in. Select Start Static Analysis.</p><p>Expected rules are <code>SAST-DANGEROUS-EVAL</code> and <code>SAST-SQL-CONCAT</code>. These inert teaching fixtures are never executed by the sample server.</p><p><img src="images/en/13-sast-before.png" alt="Before-fix static analysis"></p><p>Next, <a href="/?trainingScan=after">open the after-fix fixture</a>, scan again and confirm zero findings. This does not establish that an entire application is secure.</p><p><img src="images/en/13-sast-after.png" alt="After-fix static analysis"></p>`;
  html = html.replace(/<h2>T10\b[\s\S]*?(?=<h2>T11\b)/, analysis);
  const finish = ja
    ? `<h2>T11 終了と次の演習</h2><p>${button('reset')}でサンプルを戻します。演習記録としてセッション ID、変更した入力値、差分の理由、DAST の追加指摘、SAST のルール ID を残してください。終了時はアプリを終了します。</p>`
    : `<h2>T11 Finish</h2><p>${button('reset')} to restore sample state. Record your session ID, edited values, reason for visual differences, extra DAST findings and SAST rule IDs. Quit the application when finished.</p>`;
  html = html.replace(/<h2>T11\b[\s\S]*?(?=<h2>)/, finish);
  html = html.replaceAll('<code>npx playwright install chromium</code>', `<a href="/welcome">${ja ? 'ホームでブラウザーを導入' : 'Install the browser on Home'}</a>`)
    .replaceAll('<code>training:setup -- --reset</code>', `<a href="/welcome">${ja ? 'ホームで研修設定を初期化' : 'Reset training configuration on Home'}</a>`);
  html = html.replace('</style>', 'button[data-training-mode],button[data-start-training]{font:inherit;padding:10px 16px;background:#126575;color:white;border:0;border-radius:6px;cursor:pointer}button:disabled{opacity:.5}.course-action-status{margin-left:12px;color:#075985}</style>');
  html = html.replace('<main>', '<main>' + nav).replace('</main>', '</main><script src="/desktop/course.js"></script>');
  return html;
}
module.exports = { renderDesktopCourse };

'use strict';
// Local-only training application. No real accounts, external services or database.
const express = require('express');
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
let mode = 'baseline';
const words = {
  ja: { title: '研修申請ラボ', intro: 'Web Security Hub のための練習サイト', login: 'ログイン', email: 'メールアドレス', password: 'パスワード', dashboard: 'ダッシュボード', apply: '研修に申し込む', list: '研修一覧', name: '氏名', seats: '参加人数', course: '研修コース', consent: '案内メールを受け取る', submit: '申し込む', done: '申請を受け付けました', back: 'ダッシュボードへ', logout: 'ログアウト', hint: '架空の研修データです。何度でも練習できます。', invalid: '入力内容を確認してください', change: '変更版：参加人数の上限を 5 人から 3 人に変更しました。', help: '操作ガイド', details: '詳細を見る' },
  en: { title: 'Workshop Application Lab', intro: 'Practice site for Web Security Hub', login: 'Sign in', email: 'Email address', password: 'Password', dashboard: 'Dashboard', apply: 'Apply for a workshop', list: 'Workshops', name: 'Name', seats: 'Participants', course: 'Workshop', consent: 'Receive workshop updates', submit: 'Submit application', done: 'Application received', back: 'Back to dashboard', logout: 'Sign out', hint: 'Fictional training data. Repeat the exercises as often as you like.', invalid: 'Please check your input', change: 'Changed version: participant limit reduced from 5 to 3.', help: 'Help', details: 'View details' }
};
function render(lang, title, content, authenticated = false) {
  const w = words[lang];
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${w.title}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#17283d;font:17px/1.65 system-ui,sans-serif}header{background:#102e47;color:white;padding:24px max(24px,calc((100vw - 1000px)/2))}header small{color:#a9cedd}nav{display:flex;gap:24px;flex-wrap:wrap;padding-top:14px}header a{color:#d0f3ff}main{max-width:1000px;margin:36px auto;padding:0 24px}h1{font-size:30px;margin:0}h2{font-size:27px}a{color:#075985}article,form,.notice{background:white;border:1px solid #d8e2ec;border-radius:12px;padding:28px;margin:20px 0}form{max-width:680px}label{display:block;font-weight:600;margin:16px 0 6px}input,select,button{font:inherit;padding:10px 12px;border:1px solid #9aaec1;border-radius:6px}input:not([type=checkbox]),select{width:100%}button,.cta{display:inline-block;background:#075985;color:white;padding:12px 20px;text-decoration:none;border:0;border-radius:6px;margin-top:20px;cursor:pointer}.muted{color:#52677a}.notice{border-left:5px solid #e5a000}code{background:#e8eff5;padding:2px 6px}footer{margin-top:32px;color:#52677a}details{padding:16px;border:1px solid #d8e2ec;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:16px;border-bottom:1px solid #d8e2ec}</style>
  <header><small>LOCAL TRAINING / WEB SECURITY HUB</small><h1>${w.title}</h1><nav>${app.get('trainingHubUrl') ? `<a href="${app.get('trainingHubUrl')}">← Hub Home</a>` : ''}${authenticated ? `<a href="/${lang}/dashboard">${w.dashboard}</a><a href="/${lang}/apply">${w.apply}</a><a href="/${lang}/workshops">${w.list}</a><a href="/${lang}/logout">${w.logout}</a>` : ''}<a href="/${lang === 'ja' ? 'en' : 'ja'}/login">${lang === 'ja' ? 'English' : '日本語'}</a></nav></header><main><p class="muted">${w.intro}</p><h2>${title}</h2>${content}<footer>${w.hint} · Dataset 2026-01</footer></main></html>`;
}
app.get('/__training/state', (req, res) => res.json({ mode, dataset: '2026-01' }));
app.post('/__training/reset', (req, res) => { mode = 'baseline'; res.json({ mode }); });
app.post('/__training/mode', (req, res) => {
  if (!['baseline', 'changed', 'fixed'].includes(req.body.mode)) return res.status(400).json({ error: 'baseline | changed | fixed' });
  mode = req.body.mode; res.json({ mode });
});
app.get('/', (req, res) => res.redirect('/ja/login'));
app.use('/:lang', (req, res, next) => {
  if (!Object.hasOwn(words, req.params.lang)) return res.sendStatus(404);
  res.locals.lang = req.params.lang; next();
});
app.get('/:lang/login', (req, res) => {
  const l = res.locals.lang, w = words[l];
  res.send(render(l, w.login, `<div class="notice">Demo: <code>learner@example.test</code> / <code>training-only</code></div><form method="post" action="/${l}/login"><label for="email">${w.email}</label><input id="email" name="email" type="email" required autocomplete="username"><label for="password">${w.password}</label><input id="password" name="password" type="password" required autocomplete="current-password"><button id="sign-in" type="submit">${w.login}</button></form>`));
});
app.post('/:lang/login', (req, res) => {
  const l = res.locals.lang;
  if (req.body.email !== 'learner@example.test' || req.body.password !== 'training-only') return res.status(401).send(render(l, words[l].invalid, '<p role="alert">Demo credentials only.</p>'));
  res.cookie('training_session', 'demo-learner', { httpOnly: true, sameSite: 'lax', path: '/' });
  res.redirect(`/${l}/dashboard`);
});
app.use('/:lang', (req, res, next) => {
  if (!/(?:^|;\s*)training_session=demo-learner(?:;|$)/.test(req.headers.cookie || '')) return res.redirect(`/${res.locals.lang}/login`);
  // Only the changed version intentionally omits these two headers for the DAST exercise.
  if (mode !== 'changed') { res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"); res.set('X-Content-Type-Options', 'nosniff'); }
  next();
});
app.get('/:lang/dashboard', (req, res) => { const l = res.locals.lang, w = words[l]; res.send(render(l, w.dashboard, `${mode === 'changed' ? `<p class="notice">${w.change}</p>` : ''}<article><h3>Web Security Basics</h3><p>2026-11-10 · Online · 10:00–12:00</p><a class="cta" id="apply-link" href="/${l}/apply">${w.apply}</a></article><details><summary>${w.help}</summary><p>${l === 'ja' ? 'フォーム入力、ケース生成、ベースライン比較を練習します。' : 'Practice form entry, test generation and baseline comparison.'}</p></details>`, true)); });
app.get('/:lang/apply', (req, res) => { const l = res.locals.lang, w = words[l]; res.send(render(l, w.apply, `<form id="application" method="post" action="/${l}/complete"><label for="name">${w.name} (1–40)</label><input id="name" name="name" required maxlength="40"><label for="contact">${w.email}</label><input id="contact" name="contact" type="email" required><label for="participants">${w.seats} (1–${mode === 'changed' ? 3 : 5})</label><input id="participants" name="participants" type="number" required min="1" max="${mode === 'changed' ? 3 : 5}" value="1"><label for="course">${w.course}</label><select id="course" name="course"><option value="web">Web Security Basics</option><option value="testing">Regression Testing</option></select><label><input id="updates" name="updates" type="checkbox"> ${w.consent}</label><button id="submit-application" type="submit">${w.submit}</button></form>`, true)); });
app.post('/:lang/complete', (req, res) => {
  const l = res.locals.lang, w = words[l], n = Number(req.body.participants);
  if (!req.body.name || req.body.name.length > 40 || String(req.body.contact || '').length > 254 || !/^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(req.body.contact || '') || !Number.isInteger(n) || n < 1 || n > (mode === 'changed' ? 3 : 5) || !['web', 'testing'].includes(req.body.course)) return res.status(422).send(render(l, w.invalid, `<p role="alert">${w.invalid}</p><a href="/${l}/apply">${w.apply}</a>`, true));
  // Do not store submissions or echo values: every run has the same completion screen.
  res.redirect(`/${l}/complete`);
});
app.get('/:lang/complete', (req, res) => { const l = res.locals.lang, w = words[l]; res.send(render(l, w.done, `<article><strong>LAB-0001</strong><p>${l === 'ja' ? '練習用の申請が完了しました。データは保存されません。' : 'Practice application complete. Submissions are not stored.'}</p><a href="/${l}/dashboard">${w.back}</a></article>`, true)); });
app.get('/:lang/workshops', (req, res) => { const l = res.locals.lang, w = words[l]; res.send(render(l, w.list, `<article><table><thead><tr><th>${w.course}</th><th>Date</th><th></th></tr></thead><tbody><tr><td>Web Security Basics</td><td>2026-11-10</td><td><a href="/${l}/workshops/web">${w.details}</a></td></tr><tr><td>Regression Testing</td><td>2026-11-17</td><td><a href="/${l}/workshops/testing">${w.details}</a></td></tr></tbody></table></article>`, true)); });
app.get('/:lang/workshops/:id', (req, res) => { const l = res.locals.lang; if (!['web', 'testing'].includes(req.params.id)) return res.sendStatus(404); res.send(render(l, req.params.id === 'web' ? 'Web Security Basics' : 'Regression Testing', `<article><p>Online · 10:00–12:00</p><a href="/${l}/apply">${words[l].apply}</a></article>`, true)); });
app.get('/:lang/logout', (req, res) => { res.clearCookie('training_session', { path: '/' }); res.redirect(`/${res.locals.lang}/login`); });
if (require.main === module) app.listen(4180, '127.0.0.1', () => console.log('Training lab: http://127.0.0.1:4180 (loopback only)'));
module.exports = app;

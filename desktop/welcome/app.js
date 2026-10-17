'use strict';
const text = {
  ja: { optionalPackaged:'この配布版は Web 機能です。モバイルはソース版、ZAP・AI は別途準備が必要です。',installLog:'インストールログ',notInstalled:'診断用ブラウザーがまだありません。下のインストールボタンで準備できます。',cannotLaunch:'ブラウザーを起動できません。再インストールするか、詳細を確認してください。',diagnostics:'技術的な詳細',sastBefore:'静的解析の修正前例を開く',sastAfter:'修正後例を開く',title:'使い始める準備',intro:'環境を確認して、診断ツール・操作マニュアル・ハンズオンへ進めます。',environment:'環境チェック',check:'再確認',install:'必要なブラウザーをインストール',download:'初回はインターネットから Chromium をダウンロードします。導入先は利用者の領域です。',work:'アプリを使う',open:'診断・テストを開く',learn:'マニュアルと研修',learnHelp:'サンプルを開始すると、日英の練習サイト設定も自動的に用意します。',training:'ハンズオン環境を開始',manual:'画像付き教材を開く',desktopManual:'アプリ版の操作ガイド',sample:'サンプルサイトを開く',baseline:'基本版',changed:'変更版',fixed:'修正版',reset:'サンプルを初期化',confirmReset:'研修用2サイトの設定を初期化することを確認しました（過去の実行結果は残ります）',resetConfig:'研修設定も初期化',optional:'ZAP・モバイル・AI は任意の追加機能です。基本コースには不要です。',node:'Node.js',storage:'保存先',chromium:'診断ブラウザー',ok:'準備完了',missing:'準備が必要',checking:'確認中…',installing:'インストール中…',running:'研修環境を起動しました。',resetRequired:'初期化の確認にチェックしてください。' },
  en: { optionalPackaged:'This package includes web automation. Use the source edition for mobile; ZAP and AI need separate setup.',installLog:'Installation log',notInstalled:'The automation browser is not installed yet. Use the install button below.',cannotLaunch:'The browser could not start. Reinstall it or inspect the details.',diagnostics:'Technical details',sastBefore:'Open before-fix SAST fixture',sastAfter:'Open after-fix fixture',title:'Get started',intro:'Check your environment, then open the app, documentation or hands-on course.',environment:'Environment check',check:'Check again',install:'Install required browser',download:'First-time setup downloads Chromium from the internet into your user account.',work:'Use the application',open:'Open scanning & testing',learn:'Documentation and training',learnHelp:'Starting the sample also prepares both Japanese and English training site configurations.',training:'Start hands-on environment',manual:'Open illustrated course',desktopManual:'Desktop app guide',sample:'Open sample site',baseline:'Baseline',changed:'Changed',fixed:'Fixed',reset:'Reset sample',confirmReset:'I confirm resetting the two training site configurations (previous results will remain)',resetConfig:'Reset training configuration',optional:'ZAP, mobile and AI are optional extras. The core course does not need them.',node:'Node.js',storage:'Data location',chromium:'Automation browser',ok:'Ready',missing:'Setup needed',checking:'Checking…',installing:'Installing…',running:'Training environment started.',resetRequired:'Check the reset confirmation first.' }
};
let lang = localStorage.getItem('web-security-hub.locale') === 'en' ? 'en' : 'ja';
let timer; let lastState;
const $ = id => document.getElementById(id);
const t = key => text[lang][key] || key;
function applyLanguage() {
  document.documentElement.lang = lang; $('language').value = lang; localStorage.setItem('web-security-hub.locale', lang);
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('manual').href = `/training/README${lang === 'ja' ? '.ja' : ''}.html`;
  $('desktopManual').href = `/desktop/guide${lang === 'ja' ? '.ja' : ''}.html`;
  $('sample').href = `http://127.0.0.1:4180/${lang}/login`;
  if (lastState) render(lastState);
}
async function api(endpoint, body) {
  const r = await fetch(`/api/desktop/${endpoint}`, body === undefined ? {} : { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
}
function render(state) {
  lastState = state; $('checks').replaceChildren();
  document.querySelector('[data-i18n=optional]').textContent = t(state.packaged ? 'optionalPackaged' : 'optional');
  for (const c of state.checks) {
    const row = document.createElement('div'); row.className = 'check';
    const name = document.createElement('strong'); name.textContent = t(c.id);
    const status = document.createElement('span'); status.className = c.ok ? 'ok' : 'missing'; status.textContent = `${c.ok ? '✓' : '○'} ${t(c.ok ? 'ok' : 'missing')}`;
    const detail = document.createElement('span'); detail.textContent = c.reason ? t(c.reason) : c.detail;
    if (c.reason) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = t('diagnostics'); const pre = document.createElement('pre'); pre.textContent = c.detail; details.append(summary,pre); detail.append(details); }
    row.append(name,status,detail); $('checks').append(row);
  }
  $('storage').textContent = `${t('storage')}: ${state.dataDir}`;
  $('openHub').setAttribute('aria-disabled', String(!state.ready));
  $('install').disabled = Boolean(state.busy); $('check').disabled = Boolean(state.busy);
  $('install').textContent = t(state.busy ? 'installing' : 'install');
  $('log').textContent = (state.log || []).join(''); $('logDetails').hidden = !state.log?.length; $('logDetails').open = Boolean(state.busy || state.installError);
  $('error').textContent = state.installError || '';
  $('trainingControls').hidden = !state.sampleRunning;
}
async function refresh() {
  try {
    const state = await api('state'); render(state); clearTimeout(timer);
    if (state.busy) timer = setTimeout(refresh, 1000);
  } catch (e) { $('error').textContent = e.message; }
}
$('language').addEventListener('change', () => { lang = $('language').value; applyLanguage(); });
$('check').onclick = async () => { try { $('checks').textContent = t('checking'); await api('check', {}); await refresh(); } catch(e) { $('error').textContent = e.message; } };
$('install').onclick = async () => { try { await api('install', {}); await refresh(); } catch(e) { $('error').textContent = e.message; } };
async function training(body = {}) {
  try { const result = await api('training', body); await refresh(); $('trainingStatus').textContent = `${t('running')} ${t(result.mode)}`; }
  catch(e) { $('error').textContent = e.message; }
}
$('training').onclick = () => training();
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => training({ mode:b.dataset.mode }));
$('resetConfig').onclick = () => {
  if (!$('confirmReset').checked) { $('error').textContent = t('resetRequired'); return; }
  training({ resetConfig:true,mode:'reset' }); $('confirmReset').checked = false;
};
applyLanguage(); $('checks').textContent = t('checking'); refresh();

// Native-style navigation: only the selected workspace occupies the viewport.
const shell = document.querySelector('main');
const sections = [...shell.querySelectorAll(':scope > section')];
const nav = document.createElement('nav'); nav.className = 'home-nav'; nav.setAttribute('aria-label','Workspace');
const stage = document.createElement('div'); stage.className = 'home-stage';
const setup = document.createElement('div'); setup.className = 'home-page setup-page'; setup.append(sections[1],sections[0]);
const learn = document.createElement('div'); learn.className = 'home-page learn-page'; learn.hidden = true; learn.append(sections[2]);
stage.append(setup,learn); shell.append(nav,stage);
const intro = shell.querySelector(':scope > p'); setup.prepend(intro);
const navigation = [ ['environment',setup],['learn',learn] ];
navigation.forEach(([key,page],index) => {
  const button = document.createElement('button'); button.dataset.i18n=key; button.textContent=t(key); button.setAttribute('aria-current',String(index===0));
  button.onclick=()=>{ navigation.forEach(([,p])=>p.hidden=p!==page); [...nav.children].forEach(b=>b.setAttribute('aria-current',String(b===button))); }; nav.append(button);
});

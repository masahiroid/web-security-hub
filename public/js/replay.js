import { t } from './i18n.js';
'use strict';
import { $ } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';

/** 再実行 tab: lists sessions for the selected site and replays a session's generated.spec.ts (SSE-streamed). */

export async function loadReplaySessions() {
  const select = $('replaySession');
  select.innerHTML = '';
  if (!state.siteId) return;
  const { sessions } = await api(`/sites/${state.siteId}/sessions`);
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  }
}

function runReplay(recordBaseline) {
  const status = $('replayStatus');
  const logEl = $('replayLog');
  const resultEl = $('replayResult');
  logEl.textContent = '';
  resultEl.innerHTML = '';
  if (!state.siteId) {
    status.textContent = t('error.selectSite');
    return;
  }
  const sessionId = $('replaySession').value;
  if (!sessionId) {
    status.textContent = t('error.selectSession');
    return;
  }
  status.textContent = t('status.running');
  $('replayBaselineBtn').disabled = true;
  $('replayRunBtn').disabled = true;

  const params = new URLSearchParams();
  if (recordBaseline) params.set('baseline', '1');
  const baseUrl = $('replayBaseUrl').value.trim();
  if (baseUrl) params.set('baseUrl', baseUrl);
  if ($('replayUseZap').checked) params.set('zap', '1');
  if ($('replayActiveZap').checked) params.set('activeZap', '1');
  if ($('replayZapAuthorized').checked) params.set('authorized', '1');

  const es = new EventSource(`/api/sites/${state.siteId}/sessions/${sessionId}/replay?${params.toString()}`);
  es.addEventListener('log', (ev) => {
    const { line } = JSON.parse(ev.data);
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  });
  es.addEventListener('done', (ev) => {
    const data = JSON.parse(ev.data);
    status.textContent = data.ok ? t('status.allPassed') : t('status.differences', { code: data.exitCode });
    $('replayBaselineBtn').disabled = false;
    $('replayRunBtn').disabled = false;
    const links = [];
    if (data.reportUrl) links.push(`<a href="${data.reportUrl}" target="_blank">${t('openReport')}</a>`, `<a href="${data.markdownUrl}" target="_blank">${t('openMarkdown')}</a>`);
    if (data.zap?.alertsUrl) links.push(`<a href="${data.zap.alertsUrl}" target="_blank">ZAP Alert（ケースID付き）</a>`);
    if (data.zap?.error) links.push(`ZAP エラー: ${data.zap.error}`);
    if (links.length) resultEl.innerHTML = `<p>${links.join(' ・ ')}</p>`;
    es.close();
  });
  es.addEventListener('error', (ev) => {
    let message = t('error.connection');
    try {
      message = JSON.parse(ev.data).message;
    } catch {
      /* ignore parse errors from a raw network-level EventSource error */
    }
    status.textContent = t('status.error', { message });
    $('replayBaselineBtn').disabled = false;
    $('replayRunBtn').disabled = false;
    es.close();
  });
}

$('replayBaselineBtn').addEventListener('click', () => runReplay(true));
$('replayRunBtn').addEventListener('click', () => runReplay(false));

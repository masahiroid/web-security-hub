import { t } from './i18n.js';
'use strict';
import { $ } from './dom.js';
import { state } from './state.js';

/** テストケース作成 tab: runs the crawl -> pairwise -> codegen pipeline (SSE-streamed). */

$('runPipelineBtn').addEventListener('click', () => {
  const status = $('pipelineStatus');
  const logEl = $('pipelineLog');
  const resultEl = $('pipelineResult');
  logEl.textContent = '';
  resultEl.innerHTML = '';
  if (!state.siteId) {
    status.textContent = t('error.selectSite');
    return;
  }
  status.textContent = t('status.running');
  $('runPipelineBtn').disabled = true;

  const es = new EventSource(`/api/sites/${state.siteId}/pipeline/run`);
  es.addEventListener('log', (ev) => {
    const { line } = JSON.parse(ev.data);
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  });
  es.addEventListener('done', (ev) => {
    const data = JSON.parse(ev.data);
    status.textContent = t('status.complete');
    $('runPipelineBtn').disabled = false;
    resultEl.innerHTML = `
      <p><span class="result-ok">OK</span> ${t('pipeline.summary', { forms: data.formCount, cases: data.caseCount, executed: data.executedCaseCount, ok: data.okCaseCount, ng: data.ngCaseCount })}</p>
      <p><a href="${data.reportUrl}" target="_blank">${t('openReport')}</a> ・ <a href="${data.markdownUrl}" target="_blank">${t('openMarkdown')}</a></p>
    `;
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
    $('runPipelineBtn').disabled = false;
    es.close();
  });
});

'use strict';
import { api } from '../api.js'; import { $ } from '../dom.js'; import { renderFindings } from './renderFindings.js';
import { t } from '../i18n.js';
let lastStaticScan;
export function getLastStaticScan() { return lastStaticScan; }
function renderReportLinks(report) { if (!report?.urls) return ''; const links = [['html', 'HTML'], ['markdown', 'Markdown'], ['json', 'JSON'], ['sarif', 'SARIF']].map(([key, label]) => `<a href="${report.urls[key]}" target="_blank" rel="noopener">${label}</a>`).join(' · '); return `<p class="hint"><strong>${t('label.staticReports')}:</strong> ${links}</p>`; }
export function wireStaticScan() { $('runStatic').addEventListener('click', async () => { const status = $('staticStatus'); const result = $('staticResult'); status.textContent = t('status.analyzing'); result.innerHTML = ''; try { const data = await api('/security/static-scan', { method: 'POST', body: JSON.stringify({ sourceDir: $('sourceDir').value.trim() }) }); lastStaticScan = data; window.dispatchEvent(new CustomEvent('sastscancomplete', { detail: data })); status.textContent = `${t('status.complete')}: ${data.filesScanned} files`; result.innerHTML = renderFindings(data, data.scannedAt) + renderReportLinks(data.report); } catch (error) { lastStaticScan = undefined; status.textContent = t('status.error', { message: error.message }); } }); }

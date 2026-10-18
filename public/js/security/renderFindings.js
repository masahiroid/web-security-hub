import { t } from '../i18n.js';
import { renderSastMetadata, sastFindingText } from '../../generated/security/sastMetadata.js';
export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function renderFinding(finding, columnCount) {
  const row = `<tr><td><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></td><td>${escapeHtml(sastFindingText(finding, 'title', t))}</td><td><a href="${escapeHtml(finding.owasp.url)}" target="_blank" rel="noopener">${escapeHtml(finding.owasp.id)}</a><br><span class="hint">${escapeHtml(finding.owasp.name)}</span></td><td><code>${escapeHtml(finding.location)}</code></td><td>${escapeHtml(sastFindingText(finding, 'evidence', t))}<br><span class="hint">${t('findings.fix')}: ${escapeHtml(sastFindingText(finding, 'remediation', t))}</span></td></tr>`;
  const metadata = renderSastMetadata(finding, document.documentElement.lang);
  return row + (metadata ? `<tr class="sast-meta-row"><td colspan="${columnCount}">${metadata}</td></tr>` : '');
}
export function renderFindings(result, details) {
  const summary = Object.entries(result.summary).filter(([, count]) => count).map(([severity, count]) => `<span class="severity ${escapeHtml(severity)}">${escapeHtml(severity)} ${count}</span>`).join(' ');
  const columns = [t('findings.severity'), t('findings.title'), 'OWASP', t('findings.location'), t('findings.evidence')];
  const rows = result.findings.map(finding => renderFinding(finding, columns.length)).join('');
  const heading = `<div class="scan-summary"><strong>${t('findings.count', { count: result.findings.length })}</strong>${summary}<span class="hint">${escapeHtml(details)}</span></div>`;
  return heading + (result.findings.length ? `<table class="findings"><thead><tr>${columns.map(label => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : `<p class="result-ok">${t('findings.none')}</p>`);
}

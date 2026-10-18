import { ensureSession, object } from '../verifier/client.js';
import { clearResult, get, render } from './sourceBindingView.js';
import { useZap } from './zapRuntimeControls.js';

const TARGET = Object.freeze({ endpoint: '/api/verifier/sast-sample/target', timeoutMs: 180_000, maximumFindings: 200 });
import { text } from './sourceTargetLabels.js';
const field = (id: string) => { const value = get(id); if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement)) throw Error('Missing source field'); return value; };
let sourceDir = ''; const findings = new Map<string, Record<string, unknown>>(); let active: AbortController | undefined;
let statusKey: 'running' | 'complete' | 'incomplete' | 'failed' | 'cancelled' | undefined;
function refreshRun() { const authorization = get('sastTargetAuthorized'); get('runSastTarget').toggleAttribute('disabled', Boolean(active) || !findings.size || !field('sastOrigin').value.trim() || !(authorization instanceof HTMLInputElement) || !authorization.checked); }
function resetAuthorization() { if (!active) { statusKey = undefined; get('sastTargetStatus').textContent = ''; } const authorization = get('sastTargetAuthorized'); if (authorization instanceof HTMLInputElement) authorization.checked = false; refreshRun(); }
get('sastOrigin').addEventListener('input', resetAuthorization); get('sastFinding').addEventListener('change', resetAuthorization); get('sastTargetAuthorized').addEventListener('change', refreshRun);
function translate() {
  for (const [id, value] of [['sastTargetTitle', text().title], ['sastTargetHelp', text().help], ['sastFindingLabel', text().finding], ['sastOriginLabel', text().origin],
    ['sastTargetAuthorizedLabel', text().authorized], ['runSastTarget', text().run], ['cancelSastTarget', text().cancel], ['sastValuesTitle', text().values],
    ['sastNormalLabel', text().normal], ['sastCandidateLabel', text().candidate], ['sastExpectedLabel', text().expected], ['sastStatusLabel', text().status]] as const) get(id).textContent = value;
  if (statusKey) get('sastTargetStatus').textContent = text()[statusKey];
  if (!findings.size) { const select = field('sastFinding'); if (select instanceof HTMLSelectElement) { const option = document.createElement('option'); option.textContent = sourceDir ? text().noRoutes : text().empty; select.replaceChildren(option); } }
}
window.addEventListener('sastscancomplete', event => {
  try {
    const scan = object((event as CustomEvent<unknown>).detail); sourceDir = typeof scan.sourceDir === 'string' ? scan.sourceDir : ''; findings.clear();
    const select = field('sastFinding'); if (!(select instanceof HTMLSelectElement)) return; select.replaceChildren();
    if (Array.isArray(scan.findings)) for (const item of scan.findings as unknown[]) {
      const finding = object(item); const mapping = object(finding.routeMapping);
      if (mapping.status !== 'mapped' || !Array.isArray(mapping.routes) || mapping.routes.length !== 1) continue;
      const route = object(mapping.routes[0]); if (encodeURI(String(route.path)) !== route.path || String(route.path).includes('%') || route.parameterized !== false || !['GET', 'POST'].includes(String(route.method)) || typeof finding.findingInstanceId !== 'string') continue;
      const metadata = Object.fromEntries(['ruleId', 'findingInstanceId', 'sourceDigest', 'relativePath', 'sourceSpan', 'routeMapping'].map(key => [key, finding[key]]));
      findings.set(finding.findingInstanceId, metadata); const option = document.createElement('option'); option.value = finding.findingInstanceId;
      option.textContent = `${String(finding.ruleId)} · ${String(finding.relativePath)} · ${String(route.method)} ${String(route.path)}`; select.append(option);
      if (findings.size >= TARGET.maximumFindings) break;
    }
    resetAuthorization(); translate();
  } catch { findings.clear(); get('runSastTarget').setAttribute('disabled', ''); }
});
get('runSastTarget').addEventListener('click', async () => {
  if (active) return;
  try {
    const finding = findings.get(field('sastFinding').value); const authorized = get('sastTargetAuthorized');
    if (!finding || !(authorized instanceof HTMLInputElement) || !authorized.checked) throw Error('Authorization required');
    const origin = field('sastOrigin').value.trim(); const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.origin !== origin) throw Error('Numeric origin required');
    const input = { finding, sourceDir, origin, authorized: true, useZap: useZap(),
      normalValues: object(JSON.parse(field('sastNormalValues').value) as unknown), candidateValues: object(JSON.parse(field('sastCandidateValues').value) as unknown),
      expectedJson: object(JSON.parse(field('sastExpectedJson').value) as unknown), expectedStatus: Number(field('sastExpectedStatus').value) };
    active = new AbortController(); get('runSastTarget').setAttribute('disabled', ''); get('cancelSastTarget').removeAttribute('disabled');
    statusKey = 'running'; translate(); clearResult(); await ensureSession(active.signal);
    const response = await fetch(TARGET.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([active.signal, AbortSignal.timeout(TARGET.timeoutMs)]) });
    if (!response.ok) throw Error('Trial rejected'); const result: unknown = await response.json(); render(result);
    statusKey = object(result).state === 'completed' ? 'complete' : 'incomplete'; get('sastBindingResult').scrollIntoView({ block: 'nearest' });
  } catch { statusKey = active?.signal.aborted ? 'cancelled' : 'failed'; }
  finally { active = undefined; refreshRun(); get('cancelSastTarget').setAttribute('disabled', ''); translate(); }
});
get('cancelSastTarget').addEventListener('click', () => active?.abort());
window.addEventListener('i18nchange', translate); translate();

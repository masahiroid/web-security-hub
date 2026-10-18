import { API, text, campaignState } from './config.js';
import { jobUrl, object, request, ensureSession, type JsonObject } from './client.js';
import { field, get, renderReport, translate } from './view.js';
const panel = get('panel-verifier');
let defaults: JsonObject | null = null; let activeId: string | null = null; let busy = false; let timer: ReturnType<typeof setTimeout> | undefined; let lastReport: unknown = null;
function controls(running: boolean) {
  busy = running;
  document.querySelector<HTMLButtonElement>('[data-vpage=verifierHtmlPage]')?.toggleAttribute('disabled', running || !lastReport);
  get('verifierRun').toggleAttribute('disabled', running || !defaults); get('verifierCancel').toggleAttribute('disabled', !running);
  for (const id of ['verifierSettings','verifierLimits']) get(id).toggleAttribute('disabled', running);
}
function status(value: string) { get('verifierStatus').textContent = value; }
function finished(view: JsonObject) {
  if (view.report) {
    lastReport = view.report; renderReport(lastReport);
    const report = object(view.report); status(campaignState(report.state));
    get('verifierSaved').textContent = text('saved');
    const link = get('verifierDownload'); if (link instanceof HTMLAnchorElement && activeId) { link.href = `${jobUrl(activeId)}/report.html`; link.hidden = false; }
  } else status(text('failed'));
  controls(false);
}
async function poll() {
  if (!activeId) return;
  try {
    const view = await request(jobUrl(activeId));
    if (view.state !== 'running') { finished(view); return; }
    const progress = view.progress ? object(view.progress) : null;
    status(`${text('running')}${progress ? ` ${String(progress.executed)} / ${String(progress.planned)}` : ''}`);
    timer = setTimeout(() => { void poll(); }, API.intervalMs);
  } catch { controls(false); status(text('failed')); }
}
get('verifierRun').addEventListener('click', async () => {
  if (!defaults || busy) return;
  const values = { ...defaults, mode: field('verifierMode').value, scenario: field('verifierScenario').value, randomSeed: Number(field('verifierSeed').value), maxCandidates: Number(field('verifierCandidates').value), maxTrials: Number(field('verifierTrials').value), ttlMs: Number(field('verifierTtl').value) };
  for (const id of ['verifierSeed','verifierCandidates','verifierTrials','verifierTtl']) {
    if (!field(id).checkValidity()) { document.querySelector<HTMLButtonElement>(`[data-vpage=${id === 'verifierSeed' ? 'verifierGeneral' : 'verifierAdvanced'}]`)?.click(); field(id).reportValidity(); return; }
  }
  lastReport = null; const reportFrame = get('verifierReportReader'); if (reportFrame instanceof HTMLIFrameElement) reportFrame.src = 'about:blank';
  document.querySelector<HTMLButtonElement>('[data-vpage=verifierResultPage]')?.click();
  get('verifierRows').replaceChildren(); get('verifierEvidence').textContent = ''; get('verifierSummary').textContent = text('running');
  controls(true); status(text('running')); get('verifierDownload').hidden = true; get('verifierSaved').textContent = '';
  try {
    await ensureSession(); const job = await request(API.jobs, values); if (typeof job.jobId !== 'string') throw Error('Missing job');
    activeId = job.jobId; sessionStorage.setItem(API.storageKey, activeId); await poll();
  } catch (error: unknown) { controls(false); status(error instanceof Error && error.message === 'busy' ? text('busy') : text('failed')); }
});
get('verifierDownload').addEventListener('click', event => {
  event.preventDefault(); if (!activeId) return;
  const frame = get('verifierReportReader'); if (frame instanceof HTMLIFrameElement) frame.src = `${jobUrl(activeId)}/report.html`;
  document.querySelector<HTMLButtonElement>('[data-vpage=verifierHtmlPage]')?.click();
});
get('verifierCancel').addEventListener('click', async () => { if (activeId && busy) { try { await request(`${jobUrl(activeId)}/cancel`, {}); } catch { status(text('failed')); } } });
for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-vpage]')) {
  button.setAttribute('role', 'tab'); button.id = `tab-${button.dataset.vpage}`; button.setAttribute('aria-controls', button.dataset.vpage ?? '');
  const body = document.getElementById(button.dataset.vpage ?? ''); body?.setAttribute('role', 'tabpanel'); body?.setAttribute('aria-labelledby', button.id);
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault();
    const peers = [...panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${button.dataset.vgroup}"]`)].filter(peer => !peer.disabled);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? peers.length - 1 : (peers.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + peers.length) % peers.length;
    peers[index]?.click(); peers[index]?.focus();
  });
  button.addEventListener('click', () => {
  if (button.dataset.vpage === 'verifierHtmlPage' && activeId && lastReport) { const frame = get('verifierReportReader'); if (frame instanceof HTMLIFrameElement) frame.src = `${jobUrl(activeId)}/report.html`; }
  const group = button.dataset.vgroup; for (const peer of panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${group}"]`)) peer.setAttribute('aria-selected', String(peer === button));
  for (const page of panel.querySelectorAll<HTMLElement>(`[data-vbody="${group}"]`)) page.hidden = page.id !== button.dataset.vpage;
});
}
function language() { translate(panel); get('verifierNav').textContent = text('nav'); if (lastReport) { renderReport(lastReport); status(campaignState(object(lastReport).state)); get('verifierSaved').textContent = text('saved'); } if (!busy && !lastReport) status(text('idle')); }
new MutationObserver(language).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); language(); controls(false);
void ensureSession().then(session => {
  defaults = object(session.defaults);
  field('verifierMode').value = String(defaults.mode); field('verifierScenario').value = String(defaults.scenario);
  const limits = object(session.limits);
  for (const [id, key] of [['verifierSeed','randomSeed'],['verifierCandidates','maxCandidates'],['verifierTrials','maxTrials'],['verifierTtl','ttlMs']] as const) field(id).value = String(defaults[key]);
  for (const [id,key] of [['verifierCandidates','candidates'],['verifierTrials','trials'],['verifierTtl','ttlMs']] as const) field(id).setAttribute('max', String(limits[key]));
  controls(false);
  const previous = sessionStorage.getItem(API.storageKey); if (previous) { activeId = previous; controls(true); void poll(); }
}).catch(() => status(text('failed')));
window.addEventListener('pagehide', () => { if (timer !== undefined) clearTimeout(timer); });

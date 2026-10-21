import { GENETIC_API, geneticText, stopLabel, type GeneticLabel } from './config.js';
import { ensureSession, object, request } from '../verifier/client.js';
import { field, get } from '../verifier/view.js';
import { renderGenetic } from './view.js';

const panel = get('panel-genetic');
let activeId: string | null = null; let busy = false; let timer: ReturnType<typeof setTimeout> | undefined; let lastReport: unknown = null; let ready = false;
const jobUrl = (id: string) => `${GENETIC_API.jobs}/${encodeURIComponent(id)}`;
function status(value: string) { get('geneticStatus').textContent = value; }
function controls(running: boolean) {
  busy = running;
  get('geneticRun').toggleAttribute('disabled', running || !ready); get('geneticCancel').toggleAttribute('disabled', !running);
  get('geneticSettings').toggleAttribute('disabled', running);
}
function syncVisibility() {
  const compare = field('geneticKind').value === 'compare'; const local = field('geneticLlm').value === 'local';
  for (const id of ['geneticModeField', 'geneticMethodField', 'geneticSeedField']) get(id).hidden = compare;
  get('geneticLocalFields').hidden = !local; get('geneticRatioField').hidden = field('geneticLlm').value === 'disabled' || field('geneticMethod').value === 'rules' && !compare;
  const rules = field('geneticMethod').value === 'rules' && !compare;
  field('geneticLlm').toggleAttribute('disabled', rules); if (rules) field('geneticLlm').value = 'disabled';
}
function finished(view: Record<string, unknown>) {
  if (view.report) {
    lastReport = view.report; renderGenetic(lastReport); const report = object(view.report);
    const cancelled = report.kind === 'compare' ? report.completed === false : report.state === 'cancelled';
    status(cancelled ? geneticText('cancelled') : report.kind === 'compare' ? geneticText('saved') : stopLabel(report.state));
    get('geneticSaved').textContent = geneticText('saved');
  } else status(geneticText('failed'));
  controls(false);
}
async function poll() {
  if (!activeId) return;
  try {
    const view = await request(jobUrl(activeId));
    if (view.state !== 'running') { finished(view); return; }
    const progress = view.progress ? object(view.progress) : null;
    status(`${progress ? geneticText('progress') : geneticText('running')}${progress ? ` ${String(progress.done)} / ${String(progress.planned)}` : ''}`);
    timer = setTimeout(() => { void poll(); }, GENETIC_API.intervalMs);
  } catch { controls(false); status(geneticText('failed')); }
}
function body() {
  const compare = field('geneticKind').value === 'compare'; const mode = field('geneticLlm').value;
  const llm = { mode, endpoint: mode === 'local' ? field('geneticEndpoint').value : null, model: mode === 'local' ? field('geneticModel').value : '', candidateRatio: Number(field('geneticRatio').value) / 100 };
  return compare ? { kind: 'compare', maxTrials: Number(field('geneticTrials').value), llm }
    : { kind: 'run', mode: field('geneticMode').value, method: field('geneticMethod').value, randomSeed: Number(field('geneticSeed').value), maxTrials: Number(field('geneticTrials').value), llm };
}
get('geneticRun').addEventListener('click', async () => {
  if (!ready || busy) return;
  for (const id of ['geneticSeed', 'geneticTrials', 'geneticRatio', 'geneticEndpoint', 'geneticModel']) {
    const element = field(id); if (!element.closest('[hidden]') && !element.checkValidity()) { element.reportValidity(); return; }
  }
  lastReport = null; get('geneticRows').replaceChildren(); get('geneticHead').replaceChildren(); get('geneticEvidence').textContent = ''; get('geneticSummary').textContent = geneticText('running'); get('geneticSaved').textContent = '';
  document.querySelector<HTMLButtonElement>('[data-vpage=geneticResultPage]')?.click();
  controls(true); status(geneticText('running'));
  try {
    await ensureSession(); const job = await request(GENETIC_API.jobs, body()); if (typeof job.jobId !== 'string') throw Error('Missing job');
    activeId = job.jobId; sessionStorage.setItem(GENETIC_API.storageKey, activeId); await poll();
  } catch (error: unknown) { controls(false); status(error instanceof Error && error.message === 'busy' ? geneticText('busy') : geneticText('failed')); }
});
get('geneticCancel').addEventListener('click', async () => { if (activeId && busy) { try { await request(`${jobUrl(activeId)}/cancel`, {}); } catch { status(geneticText('failed')); } } });
for (const id of ['geneticKind', 'geneticLlm', 'geneticMethod']) get(id).addEventListener('change', syncVisibility);
for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-vpage]')) {
  button.setAttribute('role', 'tab'); button.id = `tab-${button.dataset.vpage}`; button.setAttribute('aria-controls', button.dataset.vpage ?? '');
  const page = document.getElementById(button.dataset.vpage ?? ''); page?.setAttribute('role', 'tabpanel'); page?.setAttribute('aria-labelledby', button.id);
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
    const peers = [...panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${button.dataset.vgroup}"]`)];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? peers.length - 1 : (peers.indexOf(button) + (event.key === 'ArrowRight' ? 1 : -1) + peers.length) % peers.length;
    peers[index]?.click(); peers[index]?.focus();
  });
  button.addEventListener('click', () => {
    const group = button.dataset.vgroup;
    for (const peer of panel.querySelectorAll<HTMLButtonElement>(`[data-vgroup="${group}"]`)) peer.setAttribute('aria-selected', String(peer === button));
    for (const section of panel.querySelectorAll<HTMLElement>(`[data-vbody="${group}"]`)) section.hidden = section.id !== button.dataset.vpage;
  });
}
function language() {
  panel.querySelectorAll<HTMLElement>('[data-glabel]').forEach(element => { const key = element.dataset.glabel; if (key) element.textContent = geneticText(key as GeneticLabel); });
  get('geneticNav').textContent = geneticText('nav');
  if (lastReport) { renderGenetic(lastReport); } else if (!busy) { status(geneticText('idle')); get('geneticSummary').textContent = geneticText('empty'); }
}
new MutationObserver(language).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); language(); controls(false); syncVisibility();
void ensureSession().then(() => request(GENETIC_API.defaults)).then(defaults => {
  field('geneticSeed').value = String(defaults.randomSeed); field('geneticTrials').value = String(defaults.maxTrials); field('geneticRatio').value = String(Math.round(Number(defaults.candidateRatio) * 100));
  ready = true; controls(false);
  const previous = sessionStorage.getItem(GENETIC_API.storageKey); if (previous) { activeId = previous; controls(true); void poll(); }
}).catch(() => status(geneticText('failed')));
window.addEventListener('pagehide', () => { if (timer !== undefined) clearTimeout(timer); });

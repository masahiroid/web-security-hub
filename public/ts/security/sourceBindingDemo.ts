import { object } from '../verifier/client.js';
import { get, text, render, translateControls } from './sourceBindingView.js';

const API = Object.freeze({ session: '/api/verifier/session', sample: '/api/verifier/sast-sample', timeoutMs: 30_000 });
let controller: AbortController | undefined; let last: unknown;
let statusKey: 'running' | 'completed' | 'incomplete' | 'cancelled' | 'failed' | undefined;
function status(key: NonNullable<typeof statusKey>) { statusKey = key; get('sastBindingStatus').textContent = text()[key]; }
get('runSastBinding').addEventListener('click', async () => {
  if (controller) return;
  controller = new AbortController(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(API.timeoutMs)]);
  get('runSastBinding').setAttribute('disabled', ''); get('cancelSastBinding').removeAttribute('disabled');
  last = undefined; get('sastBindingResult').replaceChildren(); status('running');
  try {
    const session = await fetch(API.session, { signal }); if (!session.ok) throw Error('Session unavailable'); signal.throwIfAborted();
    const response = await fetch(API.sample, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
    if (!response.ok) throw Error('Sample failed'); last = await response.json() as unknown; render(last);
    status(object(last).state === 'completed' ? 'completed' : 'incomplete'); get('sastBindingResult').scrollIntoView({ block: 'nearest' });
  } catch { status(controller.signal.aborted ? 'cancelled' : 'failed'); }
  finally { controller = undefined; get('runSastBinding').removeAttribute('disabled'); get('cancelSastBinding').setAttribute('disabled', ''); }
});
get('cancelSastBinding').addEventListener('click', () => controller?.abort());
function translate() { translateControls(); if (last) render(last); if (statusKey) status(statusKey); }
window.addEventListener('i18nchange', translate); translate();

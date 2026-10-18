import { ensureSession, object } from '../verifier/client.js';
import { useZap } from './zapRuntimeControls.js';
import { get, text, render, translateControls, clearResult } from './sourceBindingView.js';

const API = Object.freeze({ session: '/api/verifier/session', sample: '/api/verifier/sast-sample', timeoutMs: 180_000 });
let controller: AbortController | undefined; let last: unknown;
let statusKey: 'running' | 'completed' | 'incomplete' | 'cancelled' | 'failed' | undefined;
function status(key: NonNullable<typeof statusKey>) { statusKey = key; get('sastBindingStatus').textContent = text()[key]; }
get('runSastBinding').addEventListener('click', async () => {
  if (controller) return;
  controller = new AbortController(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(API.timeoutMs)]);
  get('runSastBinding').setAttribute('disabled', ''); get('cancelSastBinding').removeAttribute('disabled');
  last = undefined; clearResult(); status('running');
  try {
    await ensureSession(signal); signal.throwIfAborted();
    const response = await fetch(API.sample, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useZap: useZap() }), signal });
    if (!response.ok) throw Error('Sample failed'); last = await response.json() as unknown; render(last);
    status(object(last).state === 'completed' ? 'completed' : 'incomplete'); get('sastBindingResult').scrollIntoView({ block: 'nearest' });
  } catch { status(controller.signal.aborted ? 'cancelled' : 'failed'); }
  finally { controller = undefined; get('runSastBinding').removeAttribute('disabled'); get('cancelSastBinding').setAttribute('disabled', ''); }
});
get('cancelSastBinding').addEventListener('click', () => controller?.abort());
function translate() { translateControls(); if (statusKey) status(statusKey); }
window.addEventListener('i18nchange', translate); translate();

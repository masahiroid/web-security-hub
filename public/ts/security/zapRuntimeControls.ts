import { ensureSession, object } from '../verifier/client.js';
import { get } from './sourceBindingView.js';

const RUNTIME = Object.freeze({ state: '/api/verifier/zap-runtime', install: '/api/verifier/zap-runtime/install', timeoutMs: 600_000 });
const labels = {
  ja: { enabled: '専用ZAPでパッシブ検査も実行', install: 'ZAP＋Javaを導入（約330 MB）', check: '導入状態を再確認', cancel: '導入を取消', installing: '公式の固定版をダウンロード・SHA-256検証中…', ready: 'ZAP 2.17.0を利用できます。', missing: '任意の追加エンジンです。未導入でも通常の検証を実行できます。', failed: '導入または確認が完了しませんでした。再試行できます。' },
  en: { enabled: 'Include passive checks with dedicated ZAP', install: 'Install ZAP + Java (~330 MB)', check: 'Check installation', cancel: 'Cancel install', installing: 'Downloading pinned official releases and verifying SHA-256…', ready: 'ZAP 2.17.0 is ready.', missing: 'Optional engine. Normal verification works without installation.', failed: 'Install or check did not finish. You can retry.' }
};
const text = () => labels[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
let controller: AbortController | undefined; let state: 'installing' | 'ready' | 'missing' | 'failed' = 'missing';
export function useZap(): boolean { const field = get('sastUseZap'); return field instanceof HTMLInputElement && field.checked && !field.disabled; }
function render() {
  get('sastZapEnvironmentTitle').textContent = 'ZAP + Java';
  get('sastUseZapLabel').textContent = text().enabled; get('installSastZap').textContent = state === 'ready' ? text().check : text().install;
  get('cancelSastZapInstall').textContent = text().cancel; get('sastZapStatus').textContent = text()[state];
  get('installSastZap').toggleAttribute('disabled', state === 'installing');
  get('cancelSastZapInstall').toggleAttribute('disabled', state !== 'installing');
  get('sastUseZap').toggleAttribute('disabled', state !== 'ready');
}
async function refresh() {
  try { await ensureSession(); const response = await fetch(RUNTIME.state); if (!response.ok) throw Error('Runtime unavailable');
    state = object(await response.json() as unknown).installed === true ? 'ready' : 'missing';
  } catch { state = 'failed'; } render();
}
get('installSastZap').addEventListener('click', async () => {
  if (controller) return; if (state === 'ready') { void refresh(); return; } controller = new AbortController(); state = 'installing'; render();
  try {
    await ensureSession(controller.signal);
    const response = await fetch(RUNTIME.install, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(RUNTIME.timeoutMs)]) });
    if (!response.ok || object(await response.json() as unknown).installed !== true) throw Error('Runtime incomplete');
    state = 'ready'; const field = get('sastUseZap'); if (field instanceof HTMLInputElement) field.checked = true;
  } catch { state = 'failed'; } finally { controller = undefined; render(); }
});
get('cancelSastZapInstall').addEventListener('click', () => controller?.abort());
window.addEventListener('i18nchange', render); render(); void refresh();

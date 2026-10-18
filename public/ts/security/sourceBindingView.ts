import { object } from '../verifier/client.js';
import { renderSastMetadata } from './sastMetadata.js';

const labels = {
  ja: { title: 'ソースと実行スコープの照合', help: '専用サンプルを解析し、ソース・許可先を照合して正常対照と候補を送信します。上の入力欄のソースは実行しません。', run: '専用サンプルで照合を実行', cancel: '取消', running: 'ソースを照合して試行中…', cancelled: '取り消しました。', failed: '完了できませんでした。再実行してください。', completed: '照合とHTTP試行が完了しました', incomplete: '照合または試行は未完了です', control: '正常対照', candidate: '候補', notice: 'ディスク上のソースとの照合です。起動中コードとの同一性・Sink到達・脆弱性は未確認のため、評価は調査中です。ZAP警告は通信への指摘であり、このSAST指摘の再現とは別です。警告ゼロを安全とは判断しません。結果は非公開JSON／HTMLへ保存します。' },
  en: { title: 'Source and execution scope check', help: 'Analyze the dedicated sample, check its source and authorized target, then send a normal control and candidate. This does not execute the source in the input above.', run: 'Run source/scope sample', cancel: 'Cancel', running: 'Checking source and running trials…', cancelled: 'Cancelled.', failed: 'Could not finish. Please run again.', completed: 'Source checks and HTTP trials completed', incomplete: 'Source check or trial incomplete', control: 'Normal control', candidate: 'Candidate', notice: 'Disk source checks only. Loaded-code identity, sink reachability and vulnerability remain unverified; assessment is under investigation. ZAP alerts concern the request and do not confirm this SAST finding. No alerts is not a safety verdict. Results are saved as private JSON/HTML.' }
};
export function get(id: string): HTMLElement { const value = document.getElementById(id); if (!value) throw Error('Missing source binding control'); return value; }
export const text = () => labels[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
const outcomes: Record<string, readonly [string, string]> = { completed: ['試行完了', 'Trial completed'], timeout: ['時間切れ', 'Timed out'], cancelled: ['取消', 'Cancelled'], error: ['エラー', 'Error'] };
function paragraph(parent: HTMLElement, value: string) { const element = document.createElement('p'); element.textContent = value; parent.append(element); }
let latest: unknown;
export function clearResult() { latest = undefined; get('sastBindingResult').replaceChildren(); }
export function render(value: unknown) {
  latest = value;
  const result = object(value); const pair = object(result.pair); const finding = object(result.finding); const target = object(result.target);
  const output = get('sastBindingResult'); output.replaceChildren(); output.className = 'sast-binding-result';
  const heading = document.createElement('h3'); heading.textContent = result.state === 'completed' ? text().completed : text().incomplete; output.append(heading);
  paragraph(output, `${String(target.method)} ${String(target.route)}`);
  const metadata = document.createElement('div'); metadata.innerHTML = renderSastMetadata(finding, document.documentElement.lang, 'binding'); output.append(metadata);
  for (const [key, label] of [['control', text().control], ['candidate', text().candidate]] as const) {
    const trial = pair[key]; if (!trial) continue; const observation = object(object(trial).observation);
    const outcome = outcomes[String(observation.outcome)]?.[document.documentElement.lang === 'ja' ? 0 : 1] ?? text().incomplete;
    paragraph(output, `${label}: HTTP ${String(observation.status ?? '—')} · ${outcome}`);
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `${label} IDs`; details.append(summary);
    for (const field of ['jobId', 'trialId', 'seedId', 'requestId', 'authProfileId']) paragraph(details, `${field}: ${String(observation[field])}`);
    output.append(details);
    const zap = object(trial).zap ? object(object(trial).zap) : { state: 'disabled' };
    const ja = document.documentElement.lang === 'ja';
    const zapStates: Record<string, readonly [string, string]> = { disabled: ['無効', 'Disabled'], completed: ['処理完了', 'Completed'], incomplete: ['未完了', 'Incomplete'], error: ['確認エラー', 'Error'] };
    paragraph(output, `ZAP: ${zapStates[String(zap.state)]?.[ja ? 0 : 1] ?? String(zap.state)}${Array.isArray(zap.messageIds) ? ` · message ID: ${zap.messageIds.map(String).join(', ')}` : ''}`);
    if (Array.isArray(zap.alerts)) for (const item of zap.alerts as unknown[]) {
      const alert = object(item); paragraph(output, `${ja ? '警告' : 'Alert'} · plugin ${String(alert.pluginId)} · risk ${String(alert.risk)} · message ${String(alert.messageId)}`);
    }

  }
  paragraph(output, text().notice);
  if (typeof result.reportId === 'string' && /^[a-f0-9-]{36}$/.test(result.reportId)) {
    const base = `/api/verifier/sast-sample/reports/${encodeURIComponent(result.reportId)}`;
    const json = document.createElement('a'); json.textContent = 'JSON'; json.href = base + '/report.json'; json.download = `source-${result.reportId}.json`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'HTML';
    const frame = document.createElement('iframe'); frame.title = 'Source verification / ソース検証'; frame.hidden = true; frame.className = 'sast-report-reader';
    button.onclick = () => { frame.hidden = !frame.hidden; if (!frame.hidden) frame.src = base + '/report.html'; };
    output.append(json, document.createTextNode(' · '), button, frame);
  }

}
export function translateControls() {
  for (const [id, value] of [['sastBindingTitle', text().title], ['sastBindingHelp', text().help], ['runSastBinding', text().run], ['cancelSastBinding', text().cancel]] as const) get(id).textContent = value;
  if (latest) render(latest);
}

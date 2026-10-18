import { object } from '../verifier/client.js';
import { renderSastMetadata } from './sastMetadata.js';

const labels = {
  ja: { title: 'ソースと実行スコープの照合', help: '専用サンプルを解析し、ソース・許可先を照合して正常対照と候補を送信します。上の入力欄のソースは実行しません。', run: '専用サンプルで照合を実行', cancel: '取消', running: 'ソースを照合して試行中…', cancelled: '取り消しました。', failed: '完了できませんでした。再実行してください。', completed: '照合とHTTP試行が完了しました', incomplete: '照合または試行は未完了です', control: '正常対照', candidate: '候補', notice: 'ディスク上のソースとの照合です。起動中コードとの同一性・Sink到達・脆弱性は未確認のため、評価は調査中です。TLSフラグの教材例は通信に適用されません。結果はこの画面だけに表示され、保存されません。' },
  en: { title: 'Source and execution scope check', help: 'Analyze the dedicated sample, check its source and authorized target, then send a normal control and candidate. This does not execute the source in the input above.', run: 'Run source/scope sample', cancel: 'Cancel', running: 'Checking source and running trials…', cancelled: 'Cancelled.', failed: 'Could not finish. Please run again.', completed: 'Source checks and HTTP trials completed', incomplete: 'Source check or trial incomplete', control: 'Normal control', candidate: 'Candidate', notice: 'Disk source checks only. Loaded-code identity, sink reachability and vulnerability remain unverified; assessment is under investigation. The teaching TLS flag is never applied to a connection. Results appear here only and are not saved.' }
};
export function get(id: string): HTMLElement { const value = document.getElementById(id); if (!value) throw Error('Missing source binding control'); return value; }
export const text = () => labels[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
const outcomes: Record<string, readonly [string, string]> = { completed: ['試行完了', 'Trial completed'], timeout: ['時間切れ', 'Timed out'], cancelled: ['取消', 'Cancelled'], error: ['エラー', 'Error'] };
function paragraph(parent: HTMLElement, value: string) { const element = document.createElement('p'); element.textContent = value; parent.append(element); }
export function render(value: unknown) {
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
  }
  paragraph(output, text().notice);
}
export function translateControls() {
  for (const [id, value] of [['sastBindingTitle', text().title], ['sastBindingHelp', text().help], ['runSastBinding', text().run], ['cancelSastBinding', text().cancel]] as const) get(id).textContent = value;
}

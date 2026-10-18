import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../../paths';
import { createFixtureVerificationService, defaultRunOptions } from '../adapters/fixtureService';
import { CLI_EXIT } from '../domain/campaignConfig';
import { validate } from '../../contracts';
import { runSastFixture } from '../adapters/sastFixtureService';
const USAGE = `Local fixture verification / ローカル専用サンプルの検証
npm run verifier:run -- [--mode baseline|changed|fixed] [--scenario all|boundary|ownership|workflow]
  --random-seed INTEGER   Deterministic order / 再現用seed
  --max-candidates N      Per-scenario limit / 各シナリオの候補上限
  --max-trials N          Includes controls / 正常対照を含む試行上限
  --ttl-ms N              Total run time budget / 全体の時間上限
  --sast-sample           Separate source/scope binding demo; JSON on stdout (no saved report)
                         ソース・スコープ照合の専用デモ。JSON標準出力、レポート保存なし
Results are private JSON/HTML under DATA_ROOT/artifacts/private/verifier.
結果はローカルに保存します。任意URL・認証情報は受け付けません。
`;
function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw Error('Expected integer option');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Error('Expected safe integer option');
  return number;
}
export async function main(argv: readonly string[]): Promise<number> {
  let options: unknown;
  let sastSample = false;
  try {
    const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: { help: { type: 'boolean' }, 'sast-sample': { type: 'boolean' }, mode: { type: 'string' }, scenario: { type: 'string' }, 'random-seed': { type: 'string' }, 'max-candidates': { type: 'string' }, 'max-trials': { type: 'string' }, 'ttl-ms': { type: 'string' } } });
    if (values.help) { process.stdout.write(USAGE); return CLI_EXIT.success; }
    sastSample = values['sast-sample'] === true;
    if (sastSample && Object.keys(values).some(key => key !== 'sast-sample')) throw Error('Sample options cannot be combined');
    const defaults = defaultRunOptions();
    options = { ...defaults, mode: values.mode ?? defaults.mode, scenario: values.scenario ?? defaults.scenario, randomSeed: integer(values['random-seed'], defaults.randomSeed), maxCandidates: integer(values['max-candidates'], defaults.maxCandidates), maxTrials: integer(values['max-trials'], defaults.maxTrials), ttlMs: integer(values['ttl-ms'], defaults.ttlMs) };
    // Validate before installing signal handlers or creating any server/data directory.
    options = validate('runOptions', options);
  } catch { process.stderr.write(USAGE); return CLI_EXIT.usage; }
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (sastSample) {
      const result = await runSastFixture(controller.signal);
      process.stdout.write(JSON.stringify(result) + '\n');
      return controller.signal.aborted ? CLI_EXIT.interrupted : result.state === 'completed' ? CLI_EXIT.success : CLI_EXIT.incomplete;
    }
    const metadata: unknown = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw Error('Missing application version');
    const result = await createFixtureVerificationService({ applicationVersion: metadata.version }).run(options, { signal: controller.signal });
    process.stdout.write(JSON.stringify({ state: result.report.state, totals: result.report.totals, ...result.saved }) + '\n');
    return result.report.state === 'cancelled' ? CLI_EXIT.interrupted : result.report.state === 'completed' ? CLI_EXIT.success : CLI_EXIT.incomplete;
  } catch { process.stderr.write('Verification or private report save failed. / 検証または非公開レポートの保存に失敗しました。\n'); return CLI_EXIT.incomplete; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) void main(process.argv.slice(2)).then(code => { process.exitCode = code; });

import { defaultGeneticFixtureSettings } from '../domain/geneticFixtureConfig';
import { defaultLlmSettings } from '../domain/llmConfig';
import { validateGeneticFixtureOptions } from '../adapters/geneticFixtureOptions';
import type { GeneticFixtureOptions } from '../domain/geneticCampaignTypes';
import { parseArgs } from 'node:util';
import { lstatSync, readFileSync } from 'node:fs';
import { LIMITS } from '../domain/config';
import type { RunOptions } from '../domain/campaignTypes';
import type { SourceTrialOptions } from '../domain/sourceBinding';
import { defaultRunOptions } from '../adapters/fixtureService';
import { validate } from '../../contracts';

export const USAGE = `Verification / 検証
npm run verifier:run -- [--mode baseline|changed|fixed] [--scenario all|boundary|ownership|workflow]
  --random-seed INTEGER   Deterministic order / 再現用seed
  --max-candidates N      Per-scenario limit / 各シナリオの候補上限
  --max-trials N          Includes controls / 正常対照を含む試行上限
  --ttl-ms N              Total run time budget / 全体の時間上限
  --genetic-fixture      Owned compound GA sample + independent replay (no LLM)
                         専用の複合条件GAサンプルと独立再現（LLM不要）
  --llm mock|local        Optional candidate supplier (default off) / 任意のLLM候補供給
  --llm-endpoint URL      Numeric loopback origin for --llm local / loopback限定
  --llm-model NAME        Model name for --llm local
  --sast-sample [--zap]   Source/scope sample, optional owned passive ZAP
                         ソース照合サンプル。--zapで専用ZAPを使用
  --source-plan FILE     Explicit authorized local target plan (JSON)
                         許可したローカル対象のJSON設定
  --zap-install          Install pinned ZAP + Java / 固定版ZAPとJavaを導入
  --zap-status           Inspect managed engine / 導入状態を確認
Results are private JSON/HTML under DATA_ROOT/artifacts/private.
Campaigns use owned fixtures. Source plans allow numeric loopback HTTP only, anonymous profile.
campaignは専用サンプル、source planは数値loopback HTTP・anonymousだけに対応します。
`;
export type Command = { readonly kind: 'help' | 'install' | 'status' } | { readonly kind: 'sample'; readonly useZap: boolean } |
  { readonly kind: 'source'; readonly input: SourceTrialOptions } | { readonly kind: 'campaign'; readonly options: RunOptions } | { readonly kind: 'genetic'; readonly options: GeneticFixtureOptions };
function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Error('Expected integer'); return Number(value);
}
export function parseCommand(argv: readonly string[]): Command {
  const { values } = parseArgs({ args: [...argv], strict: true, allowPositionals: false, options: { help: { type: 'boolean' },
    'genetic-fixture': { type: 'boolean' }, llm: { type: 'string' }, 'llm-endpoint': { type: 'string' }, 'llm-model': { type: 'string' }, 'sast-sample': { type: 'boolean' }, zap: { type: 'boolean' }, 'zap-install': { type: 'boolean' }, 'zap-status': { type: 'boolean' }, 'source-plan': { type: 'string' },
    mode: { type: 'string' }, scenario: { type: 'string' }, 'random-seed': { type: 'string' }, 'max-candidates': { type: 'string' }, 'max-trials': { type: 'string' }, 'ttl-ms': { type: 'string' } } });
  if (values.help) return { kind: 'help' };
  const keys = Object.keys(values);
  if (values['genetic-fixture']) {
    if (keys.some(key => !['genetic-fixture', 'mode', 'random-seed', 'max-trials', 'ttl-ms', 'llm', 'llm-endpoint', 'llm-model'].includes(key))) throw Error('Combined genetic options');
    const defaults = defaultGeneticFixtureSettings();
    const llm = { ...defaultLlmSettings(), mode: values.llm ?? 'disabled', endpoint: values['llm-endpoint'] ?? null, model: values['llm-model'] ?? '' };
    return { kind: 'genetic', options: validateGeneticFixtureOptions({ mode: values.mode ?? 'baseline', llm, settings: { ...defaults,
      randomSeed: integer(values['random-seed'], defaults.randomSeed), maxTrials: integer(values['max-trials'], defaults.maxTrials),
      ttlMs: integer(values['ttl-ms'], defaults.ttlMs) } }) };
  }
  if (values['sast-sample']) {
    if (keys.some(key => !['sast-sample', 'zap'].includes(key))) throw Error('Combined options');
    return { kind: 'sample', useZap: values.zap === true };
  }
  for (const key of ['zap-install', 'zap-status', 'source-plan'] as const) if (values[key]) {
    if (keys.length !== 1) throw Error('Combined options');
    if (key === 'zap-install') return { kind: 'install' }; if (key === 'zap-status') return { kind: 'status' };
    const file = values['source-plan']; if (!file) throw Error('Missing plan'); const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.jsonPayloadBytes) throw Error('Invalid plan file');
    return { kind: 'source', input: validate('sourceTrialOptions', readFileSync(file, 'utf8')) };
  }
  if (values.zap) throw Error('ZAP requires source sample or plan');
  const defaults = defaultRunOptions();
  return { kind: 'campaign', options: validate('runOptions', { ...defaults, mode: values.mode ?? defaults.mode, scenario: values.scenario ?? defaults.scenario,
    randomSeed: integer(values['random-seed'], defaults.randomSeed), maxCandidates: integer(values['max-candidates'], defaults.maxCandidates),
    maxTrials: integer(values['max-trials'], defaults.maxTrials), ttlMs: integer(values['ttl-ms'], defaults.ttlMs) }) };
}

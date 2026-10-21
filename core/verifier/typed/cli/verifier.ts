import { createGeneticFixtureService } from '../adapters/geneticFixtureService';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PROJECT_ROOT, DATA_ROOT } from '../../../paths';
import { createFixtureVerificationService } from '../adapters/fixtureService';
import { CLI_EXIT } from '../domain/campaignConfig';
import { CONTRACT_VERSION } from '../domain/config';
import { ZAP } from '../domain/zap';
import { validate } from '../../contracts';
import { runSastFixture } from '../adapters/sastFixtureService';
import { runSourceTarget } from '../adapters/sourceTargetService';
import { installZapRuntime, readZapInstallation } from '../adapters/zapRuntimeInstall';
import { createSourceReportStore } from '../adapters/sourceReportStore';
import { parseCommand, USAGE, type Command } from './arguments';
export async function main(argv: readonly string[]): Promise<number> {
  let command: Command;
  try { command = parseCommand(argv); if (command.kind === 'help') { process.stdout.write(USAGE); return CLI_EXIT.success; } }
  catch { process.stderr.write(USAGE); return CLI_EXIT.usage; }
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (command.kind === 'install' || command.kind === 'status') {
      if (command.kind === 'install') await installZapRuntime(DATA_ROOT, controller.signal);
      process.stdout.write(JSON.stringify({ installed: Boolean(await readZapInstallation(DATA_ROOT)), version: ZAP.version }) + '\n'); return CLI_EXIT.success;
    }
    const metadata: unknown = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string') throw Error('Missing application version');
    if (command.kind === 'genetic') {
      const { report, saved } = await createGeneticFixtureService({ applicationVersion: metadata.version }).run(command.options, { signal: controller.signal });
      process.stdout.write(JSON.stringify({ state: report.state, reproduction: report.reproduction.state, trials: report.trials, generations: report.search?.generations.length ?? 0, ...saved }) + '\n');
      return report.state === 'cancelled' ? CLI_EXIT.interrupted : ['generation_limit', 'stagnation'].includes(report.state) ? CLI_EXIT.success : CLI_EXIT.incomplete;
    }
    if (command.kind === 'source' || command.kind === 'sample') {
      const result = command.kind === 'sample' ? await runSastFixture(controller.signal, { useZap: command.useZap }) : await runSourceTarget(command.input, DATA_ROOT, controller.signal);
      const report = validate('sourceReport', { ...result, schemaVersion: CONTRACT_VERSION, reportId: randomUUID(), createdAt: new Date().toISOString(), applicationVersion: metadata.version });
      const saved = await createSourceReportStore(DATA_ROOT).save(report);
      process.stdout.write(JSON.stringify({ ...report, saved }) + '\n');
      return controller.signal.aborted ? CLI_EXIT.interrupted : report.state === 'completed' ? CLI_EXIT.success : CLI_EXIT.incomplete;
    }
    if (command.kind !== 'campaign') return CLI_EXIT.usage;
    const result = await createFixtureVerificationService({ applicationVersion: metadata.version }).run(command.options, { signal: controller.signal });
    process.stdout.write(JSON.stringify({ state: result.report.state, totals: result.report.totals, ...result.saved }) + '\n');
    return result.report.state === 'cancelled' ? CLI_EXIT.interrupted : result.report.state === 'completed' ? CLI_EXIT.success : CLI_EXIT.incomplete;
  } catch { process.stderr.write('Verification or private report save failed. / 検証または非公開レポートの保存に失敗しました。\n'); return controller.signal.aborted ? CLI_EXIT.interrupted : CLI_EXIT.incomplete; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) void main(process.argv.slice(2)).then(code => { process.exitCode = code; });

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile, readSiteConfig } from '../../../core/siteConfig';
import { parseListReporterLines, writeReplayReport } from '../../../core/report/replayReport';
import { ZapClient, mapCasesToAlerts } from '../../../core/security/zapClient';
import { DEFAULTS } from '../config';
import { messageOf } from '../lib/http';
import { sessionDirFor } from '../lib/sessionPaths';

export interface ReplayOptions {
  readonly recordBaseline: boolean;
  readonly baseUrl: string;
  readonly useZap: boolean;
  readonly activeZap: boolean;
  readonly authorized: boolean;
  readonly zapBaseUrl: string;
  readonly zapProxyUrl: string;
}
export interface ReplayRun { readonly completed: Promise<ReplayResult>; cancel(): void }
export interface ReplayResult {
  readonly exitCode: number | null; readonly ok: boolean; readonly reportUrl: string | undefined; readonly markdownUrl: string | undefined; readonly zap: Readonly<Record<string, unknown>> | undefined;
}
const PROXY_MARKER = 'WEB_SECURITY_PROXY_URL';
const LEGACY_SESSION_MESSAGE = 'このセッションは旧形式です。「テストケースを編集」から保存して Playwright spec を再生成してから、ZAP 統合を実行してください。';
const nonEmptyLines = (chunk: Buffer): string[] => chunk.toString('utf8').split(/\r?\n/).filter(Boolean);

/** Collects ZAP alerts for a replay and, when requested and authorized, runs an active scan first. */
async function collectZapArtifacts(input: { siteId: string; sessionId: string; directory: string; options: ReplayOptions; onLog: (line: string) => void }) {
  const { siteId, sessionId, directory, options, onLog } = input;
  try {
    const zap = new ZapClient({ baseUrl: options.zapBaseUrl });
    const target = options.baseUrl || readSiteConfig(siteId).baseUrl;
    if (!target) throw new Error('A target URL is required');
    onLog(`ZAP 接続: ${(await zap.version()).version}`);
    let scan: Record<string, unknown> | undefined;
    if (options.activeZap) {
      if (!options.authorized) throw new Error('ZAP アクティブ検査には診断許可の確認が必要です');
      const scanId = await zap.startActiveScan(target);
      scan = { scanId, ...await zap.waitForScan(scanId, { onProgress: onLog }) };
    }
    const alerts = mapCasesToAlerts(await zap.alerts(target), await zap.messages(target));
    fs.writeFileSync(path.join(directory, 'zap-alerts.json'), JSON.stringify({ target, scannedAt: new Date().toISOString(), alerts }, null, 2));
    return { ...scan, alerts: alerts.length, alertsUrl: `/api/sites/${siteId}/sessions/${sessionId}/zap-alerts.json` };
  } catch (error: unknown) {
    onLog(`ZAP: ${messageOf(error)}`);
    return { error: messageOf(error) };
  }
}
/**
 * Runs a session's generated Playwright test in a child process, optionally through a ZAP proxy.
 * Site credentials go to the child only as environment variables, never to the log.
 */
export function startReplay(input: { siteId: string; sessionId: string; options: ReplayOptions; onLog?: (line: string) => void }): ReplayRun {
  const { siteId, sessionId, options, onLog = () => {} } = input;
  const directory = sessionDirFor(siteId, sessionId);
  if (options.useZap && !fs.readFileSync(path.join(directory, DEFAULTS.generatedSpec), 'utf8').includes(PROXY_MARKER)) throw new Error(LEGACY_SESSION_MESSAGE);
  const args = [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'test', `./${DEFAULTS.generatedSpec}`, '--reporter=list', '--output', path.join(directory, 'test-results')];
  if (options.recordBaseline) args.push('--update-snapshots');
  const credentials = readEnvFile(siteId);
  const env: NodeJS.ProcessEnv = {
    ...process.env, WEB_SECURITY_HUB_PLAYWRIGHT_TEST: require.resolve('playwright/test'),
    GOLDEN_MASTER_LOGIN_USER: credentials.LOGIN_USER || '', GOLDEN_MASTER_LOGIN_PASS: credentials.LOGIN_PASS || '',
    GOLDEN_MASTER_BASIC_USER: credentials.BASIC_USER || '', GOLDEN_MASTER_BASIC_PASS: credentials.BASIC_PASS || '',
    ...(options.baseUrl ? { BASE_URL: options.baseUrl } : {}), ...(options.useZap ? { [PROXY_MARKER]: options.zapProxyUrl } : {}),
  };
  const child = spawn(process.execPath, args, { cwd: directory, shell: false, env });
  const lines: string[] = [];
  let cancelled = false;
  onLog(`[replay] session=${directory}`);
  onLog(`[replay] running: node ${args.join(' ')}`);
  const completed = new Promise<ReplayResult>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => { const output = nonEmptyLines(chunk); lines.push(...output); if (!cancelled) output.forEach(onLog); });
    child.stderr.on('data', (chunk: Buffer) => { if (!cancelled) nonEmptyLines(chunk).forEach(onLog); });
    child.on('error', reject);
    child.on('close', exitCode => {
      if (cancelled) return;
      void (async () => {
        try {
          const results = parseListReporterLines(lines);
          const zap = options.useZap ? await collectZapArtifacts({ siteId, sessionId, directory, options, onLog }) : undefined;
          let reportUrl: string | undefined; let markdownUrl: string | undefined;
          if (results.length) {
            writeReplayReport(directory, { results, exitCode, baseUrl: options.baseUrl });
            reportUrl = `/api/sites/${siteId}/sessions/${sessionId}/replay-report.html`;
            markdownUrl = `/api/sites/${siteId}/sessions/${sessionId}/replay-report.md`;
          }
          resolve({ exitCode, ok: exitCode === 0, reportUrl, markdownUrl, zap });
        } catch (error: unknown) { reject(error instanceof Error ? error : new Error(String(error))); }
      })();
    });
  });
  return { completed, cancel() { cancelled = true; child.kill(); } };
}

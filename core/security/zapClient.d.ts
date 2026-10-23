export interface ZapScanProgress { readonly completed: boolean; readonly progress: number }
export class ZapClient {
  constructor(options?: { baseUrl?: string; apiKey?: string } | undefined);
  readonly baseUrl: string;
  version(): Promise<{ readonly version?: string }>;
  startActiveScan(targetUrl: string): Promise<string>;
  waitForScan(scanId: string, options?: { timeoutMs?: number; onProgress?: (line: string) => void }): Promise<ZapScanProgress>;
  alerts(targetUrl: string): Promise<unknown[]>;
  messages(targetUrl: string): Promise<unknown[]>;
}
export function mapCasesToAlerts(alerts: readonly unknown[], messages: readonly unknown[]): unknown[];

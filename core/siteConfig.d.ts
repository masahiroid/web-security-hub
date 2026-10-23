/** Non-secret site settings as stored in site.config.json. Unknown keys are preserved when merging. */
export interface SiteConfig {
  id?: string;
  displayName?: string;
  baseUrl?: string;
  platform?: 'web' | 'ios' | 'android';
  folder?: string;
  labels?: readonly string[];
  outputDir?: string;
  ruleSpecDir?: string;
  variables?: Readonly<Record<string, string>>;
  mobile?: { readonly deviceName?: string; readonly platformVersion?: string; readonly app?: string; readonly bundleId?: string };
  mobileScenario?: { readonly steps?: unknown };
  readonly [key: string]: unknown;
}
export interface SiteSummary { id: string; displayName?: string | undefined; labels: readonly string[] }
export interface ClientCertificate { readonly origin?: string; readonly certPath: string; readonly keyPath: string; readonly passphrase?: string | undefined }
export interface HttpCredentials { readonly username: string; readonly password: string }
/** Everything a form-generation or exploration run needs, with all paths resolved. */
export interface RunnerConfig {
  readonly siteId: string;
  readonly url: string;
  readonly engine: 'chromium' | 'firefox' | 'webkit';
  readonly device?: string | undefined;
  readonly clientCert?: ClientCertificate | undefined;
  readonly storageStatePath?: string | undefined;
  readonly httpCredentials?: HttpCredentials | undefined;
  readonly headful: boolean;
  readonly maxDepth: number;
  readonly maxPages: number;
  readonly outputDir: string;
  readonly [key: string]: unknown;
}
export function sitesDir(): string;
export function siteDir(siteId: string): string;
export function listSites(): string[];
export function listSitesByFolder(): Record<string, SiteSummary[]>;
export function readSiteConfig(siteId: string): SiteConfig;
export function writeSiteConfig(siteId: string, config: SiteConfig): void;
export function mergeSiteConfig(base: SiteConfig, incoming: unknown): SiteConfig;
export function readEnvFile(siteId: string): Record<string, string>;
export function writeEnvFile(siteId: string, updates: Readonly<Record<string, unknown>>): void;
export function buildRunnerConfig(siteId: string): { runnerConfig: RunnerConfig; outputBaseDir: string; sessionId: string };

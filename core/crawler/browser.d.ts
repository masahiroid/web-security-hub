import type { ClientCertificate, HttpCredentials } from '../siteConfig';
export interface BrowserOptions {
  headful?: boolean;
  engine?: 'chromium' | 'firefox' | 'webkit' | undefined;
  device?: string | undefined;
  clientCert?: ClientCertificate | undefined;
  storageStatePath?: string | undefined;
  recordVideoDir?: string;
  httpCredentials?: HttpCredentials | undefined;
  onDialog?: (line: string) => void;
  dialogAction?: 'accept' | 'dismiss';
}
export interface BrowserPage { close(): Promise<void> }
export class BrowserSession {
  constructor(options: BrowserOptions);
  start(): Promise<BrowserPage>;
  stop(): Promise<void>;
}

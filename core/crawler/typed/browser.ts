import { existsSync, readFileSync } from 'node:fs';
import { chromium, devices, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';
import type { ClientCertificate, HttpCredentials } from '../../siteConfig';

const ENGINES = { chromium, firefox, webkit };

export interface BrowserOptions {
  headful?: boolean;
  /** Browser engine; chromium when omitted or unknown. */
  engine?: 'chromium' | 'firefox' | 'webkit' | undefined;
  /** Playwright device descriptor name (e.g. "iPhone 14") for viewport/UA emulation. */
  device?: string | undefined;
  clientCert?: ClientCertificate | undefined;
  /** Playwright storageState JSON (cookies + localStorage) to start already signed in. */
  storageStatePath?: string | undefined;
  recordVideoDir?: string;
  httpCredentials?: HttpCredentials | undefined;
  onDialog?: (line: string) => void;
  dialogAction?: 'accept' | 'dismiss';
}

type ClientCertificateEntry = NonNullable<BrowserContextOptions['clientCertificates']>[number];

/** Thin lifecycle wrapper around a single Playwright browser/context (Chromium, Firefox, or WebKit). */
export class BrowserSession {
  readonly opts: BrowserOptions;
  browser: Browser | undefined;
  context: BrowserContext | undefined;

  constructor(opts: BrowserOptions) {
    this.opts = opts;
  }

  async start(): Promise<Page> {
    const engine = (this.opts.engine && ENGINES[this.opts.engine]) || chromium;
    this.browser = await engine.launch({ headless: !this.opts.headful });
    const deviceDescriptor = this.opts.device ? devices[this.opts.device] : undefined;
    const { recordVideoDir, httpCredentials, clientCert, storageStatePath } = this.opts;
    this.context = await this.browser.newContext({
      ...(deviceDescriptor || {}),
      ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir } } : {}),
      ...(httpCredentials ? { httpCredentials } : {}),
      ...(clientCert ? { clientCertificates: [buildClientCertificate(clientCert)] } : {}),
      ...(storageStatePath && existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
    });
    const page = await this.context.newPage();
    this.attachPageGuards(page);
    return page;
  }

  /** Opens a new tab sharing the same context (used to run test cases independently). */
  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('BrowserSession has not been started');
    const page = await this.context.newPage();
    this.attachPageGuards(page);
    return page;
  }

  attachPageGuards(page: Page): void {
    page.on('dialog', async dialog => {
      this.opts.onDialog?.(
        `dialog: type=${dialog.type()} message=${JSON.stringify(dialog.message())} default=${this.opts.dialogAction ?? 'accept'} url=${page.url()}`,
      );
      try {
        if ((this.opts.dialogAction ?? 'accept') === 'dismiss') await dialog.dismiss();
        else await dialog.accept();
      } catch {
        // ignore races between dialog open/close and our handling
      }
    });
  }

  async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}

/** Converts our {certPath, keyPath, passphrase} shape into Playwright's clientCertificates entry. */
function buildClientCertificate(clientCert: ClientCertificate): ClientCertificateEntry {
  const entry: { cert: Buffer; key: Buffer; origin?: string; passphrase?: string } = {
    cert: readFileSync(clientCert.certPath),
    key: readFileSync(clientCert.keyPath),
  };
  if (clientCert.origin) entry.origin = clientCert.origin;
  if (clientCert.passphrase) entry.passphrase = clientCert.passphrase;
  return entry as ClientCertificateEntry;
}

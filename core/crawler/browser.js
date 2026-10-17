'use strict';
const fs = require('fs');
const { chromium, firefox, webkit, devices } = require('playwright');

const ENGINES = { chromium, firefox, webkit };

/**
 * @typedef {Object} BrowserOptions
 * @property {boolean} headful
 * @property {'chromium'|'firefox'|'webkit'} [engine]
 * @property {string} [device] Playwright device descriptor name (e.g. "iPhone 14") for viewport/UA emulation.
 * @property {{origin?:string, certPath:string, keyPath:string, passphrase?:string}} [clientCert]
 * @property {string} [storageStatePath] Path to a Playwright storageState JSON (cookies + localStorage) to start already signed in — see core/scenario/authSession.js.
 * @property {string} [recordVideoDir]
 * @property {{username:string,password:string}} [httpCredentials]
 * @property {(line:string)=>void} [onDialog]
 * @property {'accept'|'dismiss'} [dialogAction]
 */

/** Thin lifecycle wrapper around a single Playwright browser/context (Chromium, Firefox, or WebKit). */
class BrowserSession {
  /** @param {BrowserOptions} opts */
  constructor(opts) {
    this.opts = opts;
    this.browser = undefined;
    this.context = undefined;
  }

  async start() {
    const engine = ENGINES[this.opts.engine] || chromium;
    this.browser = await engine.launch({ headless: !this.opts.headful });
    const deviceDescriptor = this.opts.device && devices[this.opts.device] ? devices[this.opts.device] : undefined;
    this.context = await this.browser.newContext({
      ...(deviceDescriptor || {}),
      ...(this.opts.recordVideoDir ? { recordVideo: { dir: this.opts.recordVideoDir } } : {}),
      ...(this.opts.httpCredentials ? { httpCredentials: this.opts.httpCredentials } : {}),
      ...(this.opts.clientCert ? { clientCertificates: [buildClientCertificate(this.opts.clientCert)] } : {}),
      ...(this.opts.storageStatePath && fs.existsSync(this.opts.storageStatePath) ? { storageState: this.opts.storageStatePath } : {}),
    });
    const page = await this.context.newPage();
    this.attachPageGuards(page);
    return page;
  }

  /** Opens a new tab sharing the same context (used to run test cases independently). */
  async newPage() {
    if (!this.context) throw new Error('BrowserSession has not been started');
    const page = await this.context.newPage();
    this.attachPageGuards(page);
    return page;
  }

  attachPageGuards(page) {
    page.on('dialog', async (dialog) => {
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

  async stop() {
    await this.context?.close();
    await this.browser?.close();
  }
}

/** Converts our {certPath, keyPath, passphrase} shape into Playwright's clientCertificates entry. */
function buildClientCertificate(clientCert) {
  const entry = {
    cert: fs.readFileSync(clientCert.certPath),
    key: fs.readFileSync(clientCert.keyPath),
  };
  if (clientCert.origin) entry.origin = clientCert.origin;
  if (clientCert.passphrase) entry.passphrase = clientCert.passphrase;
  return entry;
}

module.exports = { BrowserSession };

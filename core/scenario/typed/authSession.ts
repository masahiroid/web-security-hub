import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { SiteStore } from './types';

/**
 * Captures a signed-in browser session: a person logs in by hand in a visible browser (identity
 * providers such as Google are never automated), then Playwright's storageState (cookies and
 * localStorage) is saved so later runs start signed in.
 */

export const START_NAVIGATION_TIMEOUT_MS = 30_000;
const AUTH_DIR = 'auth';
const STORAGE_STATE_FILE = 'storageState.json';

export function createStorageStatePaths(store: Pick<SiteStore, 'siteDir'>) {
  const storageStatePath = (siteId: string): string => join(store.siteDir(siteId), AUTH_DIR, STORAGE_STATE_FILE);
  return { storageStatePath, hasStorageState: (siteId: string): boolean => existsSync(storageStatePath(siteId)) };
}

interface CaptureSession {
  siteId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startedAt: string;
}

export interface AuthSessionDeps {
  storageStatePath(siteId: string): string;
  launchVisibleBrowser(): Promise<Browser>;
}

export class AuthSessionCapture {
  private session: CaptureSession | undefined;
  private readonly deps: AuthSessionDeps;

  constructor(deps: AuthSessionDeps) {
    this.deps = deps;
  }

  status() {
    if (!this.session) return { active: false };
    const { siteId, startedAt } = this.session;
    return { active: true, siteId, startedAt };
  }

  async start({ siteId, startUrl }: { siteId: string; startUrl?: string | undefined }) {
    if (this.session) throw new Error('an auth session capture is already active');
    const browser = await this.deps.launchVisibleBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: START_NAVIGATION_TIMEOUT_MS }).catch(() => {});
    this.session = { siteId, browser, context, page, startedAt: new Date().toISOString() };
    return this.status();
  }

  /** Saves cookies/localStorage and closes the browser. Call once login is complete. */
  async stop() {
    if (!this.session) return { active: false, saved: false };
    const { siteId, context, browser } = this.session;
    this.session = undefined;
    const file = this.deps.storageStatePath(siteId);
    mkdirSync(dirname(file), { recursive: true });
    await context.storageState({ path: file });
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    return { active: false, saved: true, siteId, path: file };
  }

  /** Discards the capture without saving anything. */
  async cancel() {
    if (!this.session) return { active: false };
    const { context, browser } = this.session;
    this.session = undefined;
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    return { active: false, saved: false };
  }
}

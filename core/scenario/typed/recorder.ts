import type { Browser, BrowserContext, Page } from 'playwright';
import { assertHttpUrl, RECORDER_SCRIPT, sanitizeRecordedStep } from './recordingPolicy';
import { normalizeSteps } from './stepNormalization';
import { asRecord, type ResolvedScenario, type ScenarioStep } from './types';

/** One local, visible Playwright recording session. It never persists credentials. */

export const MAX_RECORDED_STEPS = 50;
/** A navigation this soon after an interaction is that interaction's effect, not a separate goto. */
export const NAVIGATION_AFTER_INTERACTION_MS = 1_200;
const RECORDER_BINDING = '__recordScenarioInteraction';

type RecordedEntry = ScenarioStep | { action: 'goto'; url: string };

interface RecordingSession {
  siteId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startedAt: string;
  includeInputValues: boolean;
  steps: RecordedEntry[];
  visitedUrls: string[];
  events: Array<{ at: string; action: string }>;
  lastInteractionAt: number;
}

export interface RecorderDeps {
  readSiteConfig(siteId: string): unknown;
  /** HTTP Basic credentials for the site, when configured. */
  httpCredentials(siteId: string): { username: string; password: string } | undefined;
  buildSiteScenario(siteId: string): { scenario: ResolvedScenario };
  /** Signs in with server-side .env values before recording begins. */
  runLogin(page: Page, targetUrl: string, scenario: { login: ResolvedScenario['login']; steps: [] }): Promise<unknown>;
  launchVisibleBrowser(): Promise<Browser>;
  now?(): Date;
}

export class PlaywrightScenarioRecorder {
  private session: RecordingSession | undefined;
  private readonly deps: RecorderDeps;

  constructor(deps: RecorderDeps) {
    this.deps = deps;
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  status() {
    if (!this.session) return { active: false };
    const { siteId, startedAt, steps, visitedUrls, events, includeInputValues } = this.session;
    return { active: true, siteId, startedAt, stepCount: steps.length, steps, visitedUrls, events, includeInputValues };
  }

  async start({ siteId, includeInputValues = false }: { siteId: string; includeInputValues?: unknown }) {
    if (this.session) throw new Error('a scenario recording is already active');
    const site = asRecord(this.deps.readSiteConfig(siteId)) ?? {};
    const targetUrl = assertHttpUrl(String(site['baseUrl']));
    const httpCredentials = this.deps.httpCredentials(siteId);
    const { scenario } = this.deps.buildSiteScenario(siteId);
    const browser = await this.deps.launchVisibleBrowser();
    const context = await browser.newContext({ ...(httpCredentials ? { httpCredentials } : {}) });
    const page = await context.newPage();
    const session: RecordingSession = {
      siteId,
      browser,
      context,
      page,
      startedAt: this.nowIso(),
      includeInputValues: Boolean(includeInputValues),
      steps: [],
      visitedUrls: [],
      events: [],
      lastInteractionAt: 0,
    };
    this.session = session;
    try {
      await this.deps.runLogin(page, targetUrl, { login: scenario.login, steps: [] });
      await context.exposeBinding(RECORDER_BINDING, async (_source, step: unknown) => this.recordInteraction(step));
      await context.addInitScript({ content: RECORDER_SCRIPT });
      await page.evaluate(RECORDER_SCRIPT);
      this.addVisitedUrl(page.url());
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = frame.url();
        this.addVisitedUrl(url);
        if (Date.now() - session.lastInteractionAt > NAVIGATION_AFTER_INTERACTION_MS) this.recordNavigation(url);
      });
      page.on('close', () => {
        if (this.session === session) this.stop().catch(() => {});
      });
      return this.status();
    } catch (error) {
      this.session = undefined;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      throw error;
    }
  }

  recordInteraction(rawStep: unknown): void {
    const session = this.session;
    if (!session) return;
    const step = sanitizeRecordedStep(rawStep, session.includeInputValues);
    if (!step || session.steps.length >= MAX_RECORDED_STEPS) return;
    try {
      const [normalized] = normalizeSteps([step]);
      if (!normalized) return;
      if (JSON.stringify(session.steps.at(-1)) === JSON.stringify(normalized)) return;
      session.steps.push(normalized);
      session.events.push({ at: this.nowIso(), action: normalized.action });
      session.lastInteractionAt = Date.now();
    } catch {
      // Ignore DOM events that cannot be expressed in the portable scenario format.
    }
  }

  recordNavigation(rawUrl: string): void {
    const session = this.session;
    if (!session || session.steps.length >= MAX_RECORDED_STEPS) return;
    try {
      const url = assertHttpUrl(rawUrl);
      const previous = session.steps.at(-1);
      if (previous?.action === 'goto' && previous.url === url) return;
      session.steps.push({ action: 'goto', url });
      session.events.push({ at: this.nowIso(), action: 'goto' });
    } catch {
      // Ignore browser-internal navigation such as about:blank.
    }
  }

  addVisitedUrl(rawUrl: string): void {
    const session = this.session;
    if (!session) return;
    try {
      const url = assertHttpUrl(rawUrl);
      if (session.visitedUrls.at(-1) !== url) session.visitedUrls.push(url);
    } catch {
      // Ignore non-http(s) navigation.
    }
  }

  async stop() {
    if (!this.session) return { active: false, steps: [] };
    const session = this.session;
    this.session = undefined;
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    return {
      active: false,
      siteId: session.siteId,
      startedAt: session.startedAt,
      stoppedAt: this.nowIso(),
      steps: session.steps,
      visitedUrls: session.visitedUrls,
      includeInputValues: session.includeInputValues,
    };
  }
}

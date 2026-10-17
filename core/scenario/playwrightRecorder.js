'use strict';

const { chromium } = require('playwright');
const { normalizeSteps, buildSiteScenario } = require('./siteScenario');
const { readSiteConfig, buildRunnerConfig } = require('../siteConfig');
const { runScenario } = require('../security/dynamic/scenarioRunner');

const MAX_RECORDED_STEPS = 50;
const SENSITIVE_NAME = /(pass(word)?|secret|token|api[_-]?key|authorization|credential)/i;

const RECORDER_SCRIPT = `(() => {
  if (window.__webSecurityHubRecorderInstalled) return;
  window.__webSecurityHubRecorderInstalled = true;
  const escape = (value) => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  const selectorFor = (element) => {
    if (!element || element.nodeType !== 1) return null;
    if (element.id) return '#' + escape(element.id);
    for (const attribute of ['data-testid', 'data-test', 'name']) {
      const value = element.getAttribute(attribute);
      if (value) return '[' + attribute + '="' + String(value).replace(/"/g, '\\\\"') + '"]';
    }
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    if (type) return tag + '[type="' + String(type).replace(/"/g, '\\\\"') + '"]';
    return tag;
  };
  const sensitive = (element) => element.type === 'password' || /pass(word)?|secret|token|api[_-]?key|authorization|credential/i.test((element.name || '') + ' ' + (element.id || ''));
  const healHintFor = (element) => {
    if (!element || element.nodeType !== 1) return undefined;
    const attr = (name) => element.getAttribute(name) || undefined;
    const text = (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || undefined;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      dataTestId: attr('data-testid') || attr('data-test'),
      name: attr('name'),
      type: attr('type'),
      role: attr('role'),
      ariaLabel: attr('aria-label'),
      placeholder: attr('placeholder'),
      text,
      classes: element.className && typeof element.className === 'string' ? element.className.trim().split(/\\s+/).slice(0, 3) : undefined,
    };
  };
  const send = (payload) => window.__recordScenarioInteraction(payload).catch(() => {});
  document.addEventListener('click', (event) => {
    const element = event.target.closest('a,button,input[type="submit"],input[type="button"],[role="button"]');
    const selector = selectorFor(element);
    if (selector) send({ action: 'click', selector, healHint: healHintFor(element) });
  }, true);
  document.addEventListener('change', (event) => {
    const element = event.target;
    const selector = selectorFor(element);
    if (!selector || sensitive(element)) return;
    if (element instanceof HTMLSelectElement) send({ action: 'select', selector, value: element.value, healHint: healHintFor(element) });
    else if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) send({ action: 'check', selector, healHint: healHintFor(element) });
  }, true);
  document.addEventListener('blur', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || sensitive(element)) return;
    const selector = selectorFor(element);
    if (selector && element.value) send({ action: 'fill', selector, value: element.value, healHint: healHintFor(element) });
  }, true);
})();`;

function assertUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('recording target must use http or https');
  return url.href;
}

function sanitizeRecordedStep(step, includeInputValues) {
  if (!step || typeof step !== 'object') return undefined;
  const healHint = step.healHint && typeof step.healHint === 'object' ? step.healHint : undefined;
  if (step.action === 'fill') {
    if (!includeInputValues || SENSITIVE_NAME.test(step.selector || '')) return undefined;
    return { action: 'fill', selector: String(step.selector || ''), value: String(step.value || ''), healHint };
  }
  if (step.action === 'select') return { action: 'select', selector: String(step.selector || ''), value: String(step.value || ''), healHint };
  if (step.action === 'check' || step.action === 'click') return { action: step.action, selector: String(step.selector || ''), healHint };
  return undefined;
}

/** One local, visible Playwright recording session. It never persists credentials. */
class PlaywrightScenarioRecorder {
  constructor() {
    this.session = undefined;
  }

  status() {
    if (!this.session) return { active: false };
    const { siteId, startedAt, steps, visitedUrls, events, includeInputValues } = this.session;
    return { active: true, siteId, startedAt, stepCount: steps.length, steps, visitedUrls, events, includeInputValues };
  }

  async start({ siteId, includeInputValues = false }) {
    if (this.session) throw new Error('a scenario recording is already active');
    const site = readSiteConfig(siteId);
    const targetUrl = assertUrl(site.baseUrl);
    const { runnerConfig } = buildRunnerConfig(siteId);
    const { scenario } = buildSiteScenario(siteId);
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ ...(runnerConfig.httpCredentials ? { httpCredentials: runnerConfig.httpCredentials } : {}) });
    const page = await context.newPage();
    const session = {
      siteId,
      browser,
      context,
      page,
      startedAt: new Date().toISOString(),
      includeInputValues: Boolean(includeInputValues),
      steps: [],
      visitedUrls: [],
      events: [],
      lastInteractionAt: 0,
    };
    this.session = session;
    try {
      // Authenticate using server-side .env values before recording begins.
      await runScenario(page, targetUrl, { login: scenario.login, steps: [] });
      await context.exposeBinding('__recordScenarioInteraction', async (_source, step) => this.recordInteraction(step));
      await context.addInitScript({ content: RECORDER_SCRIPT });
      await page.evaluate(RECORDER_SCRIPT);
      this.addVisitedUrl(page.url());
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = frame.url();
        this.addVisitedUrl(url);
        if (Date.now() - session.lastInteractionAt > 1200) this.recordNavigation(url);
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

  recordInteraction(rawStep) {
    const session = this.session;
    if (!session) return;
    const step = sanitizeRecordedStep(rawStep, session.includeInputValues);
    if (!step || session.steps.length >= MAX_RECORDED_STEPS) return;
    try {
      const normalized = normalizeSteps([step])[0];
      const previous = session.steps.at(-1);
      if (JSON.stringify(previous) === JSON.stringify(normalized)) return;
      session.steps.push(normalized);
      session.events.push({ at: new Date().toISOString(), action: normalized.action });
      session.lastInteractionAt = Date.now();
    } catch {
      // Ignore DOM events that cannot be expressed in the portable scenario format.
    }
  }

  recordNavigation(rawUrl) {
    const session = this.session;
    if (!session || session.steps.length >= MAX_RECORDED_STEPS) return;
    try {
      const url = assertUrl(rawUrl);
      const previous = session.steps.at(-1);
      if (previous?.action === 'goto' && previous.url === url) return;
      session.steps.push({ action: 'goto', url });
      session.events.push({ at: new Date().toISOString(), action: 'goto' });
    } catch {
      // Ignore browser-internal navigation such as about:blank.
    }
  }

  addVisitedUrl(rawUrl) {
    const session = this.session;
    if (!session) return;
    try {
      const url = assertUrl(rawUrl);
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
      stoppedAt: new Date().toISOString(),
      steps: session.steps,
      visitedUrls: session.visitedUrls,
      includeInputValues: session.includeInputValues,
    };
  }
}

module.exports = { PlaywrightScenarioRecorder, sanitizeRecordedStep };

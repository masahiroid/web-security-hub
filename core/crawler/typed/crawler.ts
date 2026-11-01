import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { firstLine } from './errors';
import { collectNavigation, scanForms, type PageNavigation, type ScannedForm } from './formScanner';
import { gotoWithLogin, type LoginConfig } from './login';
import { normalizeUrl, originOrEmpty } from './urls';

export interface CrawlConfig {
  maxDepth: number;
  maxPages: number;
  sameOriginOnly: boolean;
  login?: LoginConfig | undefined;
  screenshotDir?: string | undefined;
}

export interface PageSnapshot {
  url: string;
  title: string;
  markers: string[];
  textHash: string;
}

export interface CrawlResult {
  forms: ScannedForm[];
  visited: string[];
  pageSnapshots: PageSnapshot[];
}

type Log = (message: string) => void;

/** Page loads that fail with these messages are retried once. */
const TRANSIENT_PAGE_ERROR = /Execution context was destroyed|Target closed|Most likely the page has been closed/i;
const MAX_SCAN_ATTEMPTS = 2;
const DOM_SETTLE_TIMEOUT_MS = 4_000;
/** At most this many click candidates are probed per page, each in a throwaway tab. */
const MAX_CLICK_PROBES = 4;
const PROBE_ATTEMPTS = 3;
const PROBE_NAVIGATION_TIMEOUT_MS = 6_000;
const PROBE_SETTLE_TIMEOUT_MS = 5_000;
const PROBE_FIELD_TIMEOUT_MS = 4_000;
const PROBE_CLICK_TIMEOUT_MS = 3_000;
const PROBE_VISIBLE_TIMEOUT_MS = 2_000;
const PROBE_ENABLED_POLLS = 10;
const PROBE_ENABLED_POLL_MS = 200;
const PROBE_RETRY_DELAY_MS = 600;
const NO_NAVIGATION: PageNavigation = { links: [], clickableCount: 0, clickSelectors: [] };
const NON_INPUT_TYPES = ['checkbox', 'hidden', 'submit', 'button', 'radio', 'image'];

/** Follows same-site links from a seed URL to discover pages with forms. */
export async function crawlForForms(page: Page, seedUrl: string, cfg: CrawlConfig, log: Log): Promise<CrawlResult> {
  const seedOrigin = originOrEmpty(seedUrl);
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];
  const forms: ScannedForm[] = [];
  const formKeys = new Set<string>();
  const pageSnapshots: PageSnapshot[] = [];
  const queued = new Set<string>([normalizeUrl(seedUrl)]);

  const addForms = (found: readonly ScannedForm[]): void => {
    for (const form of found) {
      const key = formIdentity(form);
      if (!formKeys.has(key)) {
        formKeys.add(key);
        forms.push(form);
      }
    }
  };

  while (queue.length && visited.size < cfg.maxPages) {
    const next = queue.shift();
    if (!next) break;
    const { url, depth } = next;
    const norm = normalizeUrl(url);
    if (visited.has(norm)) continue;
    visited.add(norm);

    try {
      await gotoWithLogin(page, url, cfg.login, log);
    } catch (error) {
      log(`  [skip] ${url} (${firstLine(error)})`);
      continue;
    }
    const pageTitle = await page.title().catch(() => '');
    log(`  [state] landed url=${page.url()} title=${pageTitle || '(no-title)'}`);

    const pageForms = await scanFormsSafe(page);
    addForms(pageForms);

    const nav = await collectNavigationSafe(page);
    if (cfg.screenshotDir) {
      const shotName = `crawl-${String(visited.size).padStart(3, '0')}-d${depth}-${slugifyUrl(page.url())}.png`;
      const shotPath = join(cfg.screenshotDir, shotName);
      mkdirSync(cfg.screenshotDir, { recursive: true });
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    }
    pageSnapshots.push(await capturePageSnapshot(page));
    log(
      `  [${visited.size}/${cfg.maxPages}] depth${depth} ${url} -> form:${pageForms.length} link:${nav.links.length} clickable:${nav.clickableCount}`,
    );

    if (depth < cfg.maxDepth) {
      const enqueue = (nextUrl: string, nextDepth: number): void => {
        const n = normalizeUrl(nextUrl);
        if (!n) return;
        if (visited.has(n) || queued.has(n)) return;
        if (cfg.sameOriginOnly && originOrEmpty(n) !== seedOrigin) return;
        if (!isCrawlable(n)) return;
        queue.push({ url: n, depth: nextDepth });
        queued.add(n);
      };

      const gatePage = pageForms.some(isAgreementGateForm);
      const links = gatePage ? nav.links.filter(link => !isLikelyPolicyLink(link)) : nav.links;
      if (gatePage) {
        log(`  [state] agreement-gate detected: policy links filtered ${nav.links.length} -> ${links.length}`);
      }
      for (const link of links) enqueue(link, depth + 1);

      const clickResult = await resolveClickDestinations(page, url, nav.clickSelectors, cfg.login, log);
      addForms(clickResult.forms);
      for (const link of clickResult.urls) enqueue(link, depth + 1);
    }
  }

  return { forms, visited: Array.from(visited), pageSnapshots };
}

/** Runs a page read, retrying once when the page was navigating underneath it. */
async function retryTransient<T>(page: Page, read: () => Promise<T>, fallback: T): Promise<T> {
  for (let attempt = 0; attempt < MAX_SCAN_ATTEMPTS; attempt++) {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (!TRANSIENT_PAGE_ERROR.test(message) || attempt === MAX_SCAN_ATTEMPTS - 1) return fallback;
      await page.waitForLoadState('domcontentloaded', { timeout: DOM_SETTLE_TIMEOUT_MS }).catch(() => {});
    }
  }
  return fallback;
}

function scanFormsSafe(page: Page): Promise<ScannedForm[]> {
  return retryTransient(page, () => scanForms(page), []);
}

function collectNavigationSafe(page: Page): Promise<PageNavigation> {
  return retryTransient(page, () => collectNavigation(page), NO_NAVIGATION);
}

function isAgreementGateForm(form: ScannedForm): boolean {
  const hasAgreementCheck = form.fields.some(field => {
    if (field.type !== 'checkbox') return false;
    const text = `${field.name ?? ''} ${field.id ?? ''} ${field.label ?? ''}`.toLowerCase();
    return /(agree|consent|同意|規約)/i.test(text);
  });
  if (!hasAgreementCheck) return false;
  const submit = (form.submitSelector ?? '').toLowerCase();
  return !!submit;
}

function isLikelyPolicyLink(url: string): boolean {
  return /code=(rules|privacy|express)|\/terms\b|\/privacy\b|\/rule\b/i.test(url);
}

function formIdentity(form: ScannedForm): string {
  const fieldShape = form.fields
    .map(field => `${field.selector}:${field.type}:${field.name ?? ''}`)
    .sort()
    .join('|');
  return `${normalizeUrl(form.url)}::${form.formSelector}::${form.submitSelector ?? ''}::${fieldShape}`;
}

function slugifyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const raw = `${parsed.pathname}${parsed.search}`;
    const slug = raw.replace(/^\/+/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'root';
  } catch {
    return 'page';
  }
}

const hasInputForm = (found: readonly ScannedForm[]): boolean =>
  found.some(form => form.fields.some(field => !NON_INPUT_TYPES.includes(field.type)));

async function resolveClickDestinations(
  page: Page,
  sourceUrl: string,
  selectors: readonly string[],
  login: LoginConfig | undefined,
  log: Log,
): Promise<{ urls: string[]; forms: ScannedForm[] }> {
  const out = new Set<string>();
  const forms: ScannedForm[] = [];
  const formKeys = new Set<string>();
  const targets = selectors.slice(0, MAX_CLICK_PROBES);
  if (page.isClosed()) return { urls: [], forms: [] };

  for (const selector of targets) {
    let probe: Page | undefined;
    try {
      probe = await page.context().newPage();
      await gotoWithLogin(probe, sourceUrl, login, () => {});
      const before = normalizeUrl(probe.url());
      log(`  [click-probe] open source=${sourceUrl} current=${before} selector=${selector}`);

      try {
        const checkboxes = probe.locator('input[type="checkbox"]');
        const count = await checkboxes.count();
        let checkedNow = 0;
        for (let i = 0; i < count; i++) {
          const checkbox = checkboxes.nth(i);
          const isChecked = await checkbox.isChecked().catch(() => false);
          if (!isChecked) {
            await checkbox.check({ force: true }).catch(() => {});
            checkedNow++;
          }
        }
        if (count > 0) log(`  [click-probe] auto-check checkboxes total=${count} checkedNow=${checkedNow}`);
      } catch {
        log('  [click-probe] auto-check failed (ignored)');
      }

      const target = probe.locator(selector).first();
      if (!(await target.count().catch(() => 0))) continue;
      await target.waitFor({ state: 'visible', timeout: PROBE_VISIBLE_TIMEOUT_MS }).catch(() => {});
      for (let poll = 0; poll < PROBE_ENABLED_POLLS; poll++) {
        if (await target.isEnabled().catch(() => true)) break;
        await probe.waitForTimeout(PROBE_ENABLED_POLL_MS).catch(() => {});
      }

      let discoveredForms: ScannedForm[] = [];
      for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt++) {
        const navigation = probe.waitForNavigation({ timeout: PROBE_NAVIGATION_TIMEOUT_MS }).catch(() => {});
        const clicked = await target.click({ timeout: PROBE_CLICK_TIMEOUT_MS }).then(() => true).catch(() => false);
        if (!clicked) await target.click({ force: true, timeout: PROBE_CLICK_TIMEOUT_MS }).catch(() => {});
        await navigation;
        await probe.waitForLoadState('networkidle', { timeout: PROBE_SETTLE_TIMEOUT_MS }).catch(() => {});
        await probe
          .locator('input[type="text"], input[type="tel"], input[type="email"], select, textarea')
          .first()
          .waitFor({ state: 'visible', timeout: PROBE_FIELD_TIMEOUT_MS })
          .catch(() => {});
        discoveredForms = await scanForms(probe).catch(() => []);
        if (hasInputForm(discoveredForms)) break;
        await probe.locator('input[type="checkbox"]').first().check({ force: true }).catch(() => {});
        await probe.waitForTimeout(PROBE_RETRY_DELAY_MS).catch(() => {});
      }
      const after = normalizeUrl(probe.url());
      log(`  [click-probe] clicked selector=${selector} before=${before} after=${after} inputForm=${hasInputForm(discoveredForms)}`);
      if (after && after !== before) out.add(after);
      if (discoveredForms.length) log(`  [click-probe] discovered forms=${discoveredForms.length} after click`);
      for (const form of discoveredForms) {
        const key = formIdentity(form);
        if (formKeys.has(key)) continue;
        formKeys.add(key);
        forms.push(form);
      }
    } catch {
      log(`  [click-probe] failed selector=${selector} (ignored)`);
      continue;
    } finally {
      if (probe && !probe.isClosed()) await probe.close().catch(() => {});
    }
  }

  return { urls: Array.from(out), forms };
}

async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  const raw = await page.evaluate(() => {
    const title = document.title || '';
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const markers = Array.from(document.querySelectorAll('h1, h2, h3, label, button, th, dt'))
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(text => text.length >= 2)
      .slice(0, 12);
    return { title, bodyText, markers };
  });

  const digestSource = `${raw.title}\n${raw.bodyText}`;
  return {
    url: page.url(),
    title: raw.title,
    markers: Array.from(new Set(raw.markers)),
    textHash: createHash('sha1').update(digestSource).digest('hex'),
  };
}

function isCrawlable(url: string): boolean {
  if (/^(mailto:|tel:|javascript:)/i.test(url)) return false;
  if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|css|js|ico|woff2?|ttf|mp4|xlsx?|docx?)(\?|$)/i.test(url)) return false;
  return true;
}

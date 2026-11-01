import type { Locator, Page } from 'playwright';
import { sameUrl } from './urls';

export interface LoginConfig {
  loginUrl?: string | undefined;
  username: string;
  password: string;
  usernameSelector?: string | undefined;
  passwordSelector?: string | undefined;
  submitSelector?: string | undefined;
}

type Log = (message: string) => void;

const USERNAME_CANDIDATES = [
  'input[autocomplete="username"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="mail" i]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[id*="mail" i]',
  'input[type="email"]',
  'input[type="text"]',
];

const PASSWORD_CANDIDATES = ['input[autocomplete="current-password"]', 'input[type="password"]'];

const SUBMIT_CANDIDATES = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("ログイン")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'input[value*="ログイン"]',
  'input[value*="Login" i]',
];

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 5_000;
const LOGIN_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Navigates to targetUrl, handling a login screen along the way if one is
 * encountered (heuristic candidate-selector based, no site-specific selectors
 * required unless config provides explicit ones).
 */
export async function gotoWithLogin(page: Page, targetUrl: string, config: LoginConfig | undefined, log: Log): Promise<void> {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  if (!config?.username) return;

  const handled = await loginIfPresent(page, config, log);
  if (!handled) return;

  if (!sameUrl(targetUrl, page.url())) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
  }
}

async function loginIfPresent(page: Page, config: LoginConfig, log: Log): Promise<boolean> {
  const hasExplicitSelectors = Boolean(config.usernameSelector || config.passwordSelector);
  if (!hasExplicitSelectors && !(await looksLikeLoginPage(page, config))) return false;

  let username = await resolveLocator(page, config.usernameSelector, USERNAME_CANDIDATES);
  let password = await resolveLocator(page, config.passwordSelector, PASSWORD_CANDIDATES);

  if (!username || !password) {
    const fallback = await resolveLocatorsFromForms(page);
    username = username ?? fallback.username;
    password = password ?? fallback.password;
  }

  if (!username && !password) {
    if (await looksLikeLoginPage(page, config)) {
      throw new Error(
        `Page looks like a login screen (${page.url()}) but no input fields could be located. Set usernameSelector/passwordSelector explicitly.`,
      );
    }
    return false;
  }

  log(`  Login screen detected: ${page.url()}`);

  if (username && !password) {
    await username.fill(config.username);
    log('  Filled login id');
    await submitLoginStep(page, username, config, log);
    await page.waitForLoadState('networkidle', { timeout: LOGIN_SETTLE_TIMEOUT_MS }).catch(() => {});
    username = await resolveLocator(page, config.usernameSelector, USERNAME_CANDIDATES);
    password = await resolveLocator(page, config.passwordSelector, PASSWORD_CANDIDATES);
  }

  if (!username && !password) return true;

  if (!password) {
    throw new Error('Could not locate the password field. Set passwordSelector explicitly.');
  }

  if (username) {
    await username.fill(config.username);
    log('  Filled login id');
  }
  await password.fill(config.password);
  log('  Filled password');

  await submitLoginStep(page, password, config, log);
  await page.waitForLoadState('networkidle', { timeout: LOGIN_SETTLE_TIMEOUT_MS }).catch(() => {});

  const passwordStillVisible = await resolveLocator(page, config.passwordSelector, PASSWORD_CANDIDATES);
  if (passwordStillVisible) {
    throw new Error(`Password field still visible after login attempt (possible auth failure). Current URL: ${page.url()}`);
  }

  log(`  Login complete: ${page.url()}`);
  return true;
}

async function submitLoginStep(page: Page, fallbackField: Locator, config: LoginConfig, log: Log): Promise<void> {
  const submit = await resolveLocator(page, config.submitSelector, SUBMIT_CANDIDATES);
  if (submit) {
    await submit.click();
    log('  Clicked login button');
    return;
  }
  await fallbackField.press('Enter');
  log('  Submitted login via Enter');
}

async function resolveLocator(page: Page, explicitSelector: string | undefined, candidates: readonly string[]): Promise<Locator | undefined> {
  const selectors = explicitSelector ? expandExplicitSelector(explicitSelector) : candidates;
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = locator.nth(i);
      if (await isVisible(candidate)) return candidate;
    }
  }
  return undefined;
}

function expandExplicitSelector(selector: string): string[] {
  const trimmed = selector.trim();
  if (!trimmed) return [];
  if (/[#.[\]: >+~,'"*=()]/.test(trimmed)) return [trimmed];
  return [trimmed, `#${trimmed}`, `[name="${cssAttrEscape(trimmed)}"]`, `input[name="${cssAttrEscape(trimmed)}"]`, `input[id="${cssAttrEscape(trimmed)}"]`];
}

function cssAttrEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

async function resolveLocatorsFromForms(page: Page): Promise<{ username?: Locator; password?: Locator }> {
  const forms = page.locator('form');
  const formCount = await forms.count().catch(() => 0);
  for (let i = 0; i < formCount; i++) {
    const form = forms.nth(i);
    const password = await firstVisibleWithin(form, ['input[type="password"]', 'input[autocomplete="current-password"]']);
    if (!password) continue;

    const username = await firstVisibleWithin(form, [
      'input[autocomplete="username"]',
      'input[type="email"]',
      'input[name*="mail" i]',
      'input[id*="mail" i]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[type="text"]',
      'input:not([type])',
    ]);
    return { ...(username ? { username } : {}), password };
  }
  return {};
}

async function firstVisibleWithin(root: Locator, selectors: readonly string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = locator.nth(i);
      if (await isVisible(candidate)) return candidate;
    }
  }
  return undefined;
}

async function looksLikeLoginPage(page: Page, config: LoginConfig): Promise<boolean> {
  const currentUrl = page.url().toLowerCase();
  if (config.loginUrl && sameUrl(config.loginUrl, page.url())) return true;
  if (/(login|signin|sign-in|auth)/.test(currentUrl)) return true;
  const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
  return passwordCount > 0;
}

async function isVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  if (!count) return false;
  return locator.isVisible().catch(() => false);
}

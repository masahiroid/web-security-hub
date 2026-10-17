'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { siteDir } = require('../siteConfig');

/**
 * Captures an authenticated browser session by letting a human log in by hand
 * (including through a third-party identity provider like Google, which we
 * deliberately never automate — see core/scenario/playwrightRecorder.js's
 * login handling for form-based credentials instead) in a visible browser,
 * then saving Playwright's `storageState` (cookies + localStorage) so later
 * automated runs can start already signed in, without re-driving the login
 * form on every run.
 */
function storageStatePath(siteId) {
  return path.join(siteDir(siteId), 'auth', 'storageState.json');
}

function hasStorageState(siteId) {
  return fs.existsSync(storageStatePath(siteId));
}

class AuthSessionCapture {
  constructor() {
    this.session = undefined;
  }

  status() {
    if (!this.session) return { active: false };
    const { siteId, startedAt } = this.session;
    return { active: true, siteId, startedAt };
  }

  async start({ siteId, startUrl }) {
    if (this.session) throw new Error('an auth session capture is already active');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    if (startUrl) await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    this.session = { siteId, browser, context, page, startedAt: new Date().toISOString() };
    return this.status();
  }

  /** Saves the current cookies/localStorage and closes the browser. Call once login is complete. */
  async stop() {
    if (!this.session) return { active: false, saved: false };
    const { siteId, context, browser } = this.session;
    this.session = undefined;
    const file = storageStatePath(siteId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await context.storageState({ path: file });
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    return { active: false, saved: true, siteId, path: file };
  }

  /** Discards the in-progress capture without saving anything. */
  async cancel() {
    if (!this.session) return { active: false };
    const { context, browser } = this.session;
    this.session = undefined;
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    return { active: false, saved: false };
  }
}

module.exports = { AuthSessionCapture, storageStatePath, hasStorageState };

'use strict';
// Recording and auth-capture lifecycles with an injected fake browser (no real window is opened).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PlaywrightScenarioRecorder } = require('../core/generated/scenario/typed/recorder');
const { AuthSessionCapture } = require('../core/generated/scenario/typed/authSession');

function fakeBrowser(log) {
  const listeners = {};
  const frame = { url: () => 'https://site.test/other' };
  const page = {
    url: () => 'https://site.test/home',
    evaluate: async () => log.push('evaluate'),
    mainFrame: () => frame,
    on: (name, fn) => (listeners[name] = fn),
    goto: async (url) => log.push(`goto ${url}`),
  };
  const context = {
    newPage: async () => page,
    exposeBinding: async (name) => log.push(`bind ${name}`),
    addInitScript: async () => log.push('init'),
    storageState: async ({ path: file }) => fs.writeFileSync(file, '{}'),
    close: async () => log.push('context closed'),
  };
  const browser = { newContext: async (options) => (log.push(`context ${JSON.stringify(options)}`), context), close: async () => log.push('browser closed') };
  return { browser, listeners, frame };
}

test('recorder keeps sanitized, de-duplicated steps and navigations, then closes the browser', async () => {
  const log = [];
  const { browser, listeners, frame } = fakeBrowser(log);
  const recorder = new PlaywrightScenarioRecorder({
    readSiteConfig: () => ({ baseUrl: 'https://site.test/' }),
    httpCredentials: () => ({ username: 'u', password: 'p' }),
    buildSiteScenario: () => ({ scenario: { login: undefined, steps: [] } }),
    runLogin: async (_page, url) => log.push(`login ${url}`),
    launchVisibleBrowser: async () => browser,
  });
  const started = await recorder.start({ siteId: 'demo' });
  assert.equal(started.active, true);
  await assert.rejects(recorder.start({ siteId: 'demo' }), /already active/);

  recorder.recordInteraction({ action: 'click', selector: '#go' });
  recorder.recordInteraction({ action: 'click', selector: '#go' });
  recorder.recordInteraction({ action: 'fill', selector: '#q', value: 'not kept' });
  recorder.recordInteraction({ action: 'eval', selector: '#x' });
  recorder.recordNavigation('about:blank');
  recorder.recordNavigation('https://site.test/next');
  recorder.recordNavigation('https://site.test/next');
  listeners.framenavigated(frame);

  const stopped = await recorder.stop();
  assert.deepEqual(stopped.steps, [{ action: 'click', selector: '#go' }, { action: 'goto', url: 'https://site.test/next' }]);
  assert.deepEqual(stopped.visitedUrls, ['https://site.test/home', 'https://site.test/other']);
  assert.equal(stopped.includeInputValues, false);
  assert.ok(log.includes('context {"httpCredentials":{"username":"u","password":"p"}}'));
  assert.ok(log.includes('login https://site.test/'));
  assert.ok(log.includes('browser closed'));
  assert.deepEqual(await recorder.stop(), { active: false, steps: [] });
});

test('recorder rejects non-http targets before opening a browser', async () => {
  let launched = false;
  const recorder = new PlaywrightScenarioRecorder({
    readSiteConfig: () => ({ baseUrl: 'file:///etc/passwd' }),
    httpCredentials: () => undefined,
    buildSiteScenario: () => ({ scenario: { login: undefined, steps: [] } }),
    runLogin: async () => {},
    launchVisibleBrowser: async () => ((launched = true), {}),
  });
  await assert.rejects(recorder.start({ siteId: 'demo' }), /http or https/);
  assert.equal(launched, false);
});

test('recorder closes the browser and clears the session when sign-in fails', async () => {
  const log = [];
  const { browser } = fakeBrowser(log);
  const recorder = new PlaywrightScenarioRecorder({
    readSiteConfig: () => ({ baseUrl: 'https://site.test/' }),
    httpCredentials: () => undefined,
    buildSiteScenario: () => ({ scenario: { login: undefined, steps: [] } }),
    runLogin: async () => {
      throw new Error('login failed');
    },
    launchVisibleBrowser: async () => browser,
  });
  await assert.rejects(recorder.start({ siteId: 'demo' }), /login failed/);
  assert.deepEqual(recorder.status(), { active: false });
  assert.ok(log.includes('browser closed'));
});

test('auth capture saves storage state on stop and discards it on cancel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-auth-'));
  try {
    const log = [];
    const file = path.join(dir, 'auth', 'storageState.json');
    const capture = new AuthSessionCapture({ storageStatePath: () => file, launchVisibleBrowser: async () => fakeBrowser(log).browser });
    assert.equal((await capture.start({ siteId: 'demo', startUrl: 'https://site.test/login' })).active, true);
    assert.ok(log.includes('goto https://site.test/login'));
    assert.deepEqual(await capture.stop(), { active: false, saved: true, siteId: 'demo', path: file });
    assert.ok(fs.existsSync(file));

    await capture.start({ siteId: 'demo' });
    assert.deepEqual(await capture.cancel(), { active: false, saved: false });
    assert.deepEqual(await capture.cancel(), { active: false });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

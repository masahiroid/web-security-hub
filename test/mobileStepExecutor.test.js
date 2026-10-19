'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { runMobileSteps } = require('../core/mobile/mobileStepExecutor');
const { buildCapabilities } = require('../core/mobile/mobileSession');

function fakeDriver() {
  const calls = [];
  return {
    calls,
    $(selector) {
      return {
        click: async () => calls.push(`click:${selector}`),
        setValue: async (value) => calls.push(`setValue:${selector}=${value}`),
        waitForDisplayed: async () => calls.push(`waitForDisplayed:${selector}`),
      };
    },
    pause: async (ms) => calls.push(`pause:${ms}`),
    performActions: async () => calls.push('performActions'),
    releaseActions: async () => calls.push('releaseActions'),
  };
}

test('runMobileSteps dispatches tap/fill/wait/waitForSelector to the WebdriverIO-shaped driver', async () => {
  const driver = fakeDriver();
  await runMobileSteps(driver, [
    { action: 'tap', selector: '~loginButton' },
    { action: 'fill', selector: '~username', value: 'alice' },
    { action: 'wait', value: 100 },
    { action: 'waitForSelector', selector: '~dashboard' },
  ]);
  assert.deepEqual(driver.calls, ['click:~loginButton', 'setValue:~username=alice', 'pause:100', 'waitForDisplayed:~dashboard']);
});

test('runMobileSteps repeats loop.steps loop.times times', async () => {
  const driver = fakeDriver();
  await runMobileSteps(driver, [{ action: 'loop', times: 3, steps: [{ action: 'tap', selector: '~next' }] }]);
  assert.deepEqual(driver.calls, ['click:~next', 'click:~next', 'click:~next']);
});

test('runMobileSteps performs a swipe as a pointer action sequence', async () => {
  const driver = fakeDriver();
  await runMobileSteps(driver, [{ action: 'swipe', fromX: 100, fromY: 500, toX: 100, toY: 100 }]);
  assert.deepEqual(driver.calls, ['performActions', 'releaseActions']);
});

test('runMobileSteps rejects an unsupported action rather than silently skipping it', async () => {
  const driver = fakeDriver();
  await assert.rejects(() => runMobileSteps(driver, [{ action: 'setFile', selector: '~x' }]), /unsupported mobile step action/);
});

test('buildCapabilities builds XCUITest capabilities for iOS with a bundleId', () => {
  const caps = buildCapabilities({ platform: 'ios', deviceName: 'iPhone 17', platformVersion: '27.0', bundleId: 'com.apple.mobilesafari' });
  assert.equal(caps.platformName, 'iOS');
  assert.equal(caps['appium:automationName'], 'XCUITest');
  assert.equal(caps['appium:bundleId'], 'com.apple.mobilesafari');
  assert.equal(caps['appium:app'], undefined);
});

test('buildCapabilities builds UiAutomator2 capabilities for Android with an app path', () => {
  const caps = buildCapabilities({ platform: 'android', deviceName: 'Pixel_7_API_34', app: '/path/to/app.apk' });
  assert.equal(caps.platformName, 'Android');
  assert.equal(caps['appium:automationName'], 'UiAutomator2');
  assert.equal(caps['appium:app'], '/path/to/app.apk');
});

test('buildCapabilities rejects an unsupported platform', () => {
  assert.throws(() => buildCapabilities({ platform: 'windows' }), /unsupported mobile platform/);
});

test('WebdriverIO opens and closes a W3C Appium session over loopback', async t => {
  const http = require('node:http');
  const { remote } = require('webdriverio');
  const requests = [];
  const capabilities = buildCapabilities({ platform: 'ios', deviceName: 'Fixture simulator', platformVersion: '18.0', bundleId: 'org.example.fixture' });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/session') {
      res.end(JSON.stringify({ value: { sessionId: 'fixture-session', capabilities } }));
    } else if (req.method === 'DELETE' && req.url === '/session/fixture-session') {
      res.end(JSON.stringify({ value: null }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ value: { error: 'unknown command', message: 'Unexpected fixture request' } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const driver = await remote({ hostname: '127.0.0.1', port: server.address().port, path: '/', capabilities, logLevel: 'silent', connectionRetryCount: 0 });
  try {
    assert.equal(driver.sessionId, 'fixture-session');
    assert.equal(driver.isIOS, true);
    assert.equal(requests[0].body.capabilities.alwaysMatch['appium:bundleId'], 'org.example.fixture');
    assert.equal(requests[0].body.capabilities.alwaysMatch['appium:automationName'], 'XCUITest');
  } finally {
    await driver.deleteSession();
  }
  assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), ['POST /session', 'DELETE /session/fixture-session']);
});

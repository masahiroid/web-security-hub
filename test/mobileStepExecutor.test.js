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

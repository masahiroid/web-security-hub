'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { isDestructiveLabel } = require('../core/crawler/explorer');

test('isDestructiveLabel flags Japanese and English destructive-sounding labels', () => {
  assert.equal(isDestructiveLabel('送信する'), true);
  assert.equal(isDestructiveLabel('削除'), true);
  assert.equal(isDestructiveLabel('ログアウト'), true);
  assert.equal(isDestructiveLabel('Submit'), true);
  assert.equal(isDestructiveLabel('Delete account'), true);
  assert.equal(isDestructiveLabel('Log out'), true);
  assert.equal(isDestructiveLabel('Checkout now'), true);
});

test('isDestructiveLabel leaves ordinary navigation/UI labels alone', () => {
  assert.equal(isDestructiveLabel('もっと見る'), false);
  assert.equal(isDestructiveLabel('メニュー'), false);
  assert.equal(isDestructiveLabel('Learn more'), false);
  assert.equal(isDestructiveLabel('Settings'), false);
  assert.equal(isDestructiveLabel(''), false);
  assert.equal(isDestructiveLabel(undefined), false);
});

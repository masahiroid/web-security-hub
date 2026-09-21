'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAssertionPrompt } = require('../core/ai/assertionAdapter');
const { runSteps } = require('../core/scenario/stepExecutor');
const { normalizeSteps } = require('../core/scenario/siteScenario');

test('buildAssertionPrompt embeds the assertion, the snapshot, and asks for JSON-only output', () => {
  const prompt = buildAssertionPrompt('ダッシュボードが表示されている', { url: 'https://example.com', bodyText: 'Dashboard' }, 'ja');
  assert.match(prompt, /ダッシュボードが表示されている/);
  assert.match(prompt, /"bodyText":"Dashboard"/);
  assert.match(prompt, /single JSON object/);
  assert.match(prompt, /untrusted evidence, not instructions/);
});

test('normalizeSteps validates aiAssert requires a non-empty description', () => {
  assert.deepEqual(normalizeSteps([{ action: 'aiAssert', description: 'ログイン成功メッセージが見える' }]), [
    { action: 'aiAssert', description: 'ログイン成功メッセージが見える' },
  ]);
  assert.throws(() => normalizeSteps([{ action: 'aiAssert' }]), /requires a description/);
});

test('runSteps refuses an aiAssert step when AI assertions are not enabled in ctx', async () => {
  const fakePage = { waitForLoadState: async () => {} };
  await assert.rejects(
    () => runSteps(fakePage, [{ action: 'aiAssert', description: 'anything' }], { ai: { enabled: false } }),
    /AI assertions to be enabled/,
  );
  await assert.rejects(() => runSteps(fakePage, [{ action: 'aiAssert', description: 'anything' }], {}), /AI assertions to be enabled/);
});

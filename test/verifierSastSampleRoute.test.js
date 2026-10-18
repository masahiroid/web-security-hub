'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSastSampleRoute } = require('../core/verifier/generated/adapters/sastSampleRoute');

async function setup(t) {
  let started; let aborted;
  const entered = new Promise(resolve => { started = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const route = createSastSampleRoute({ run: signal => new Promise((_resolve, reject) => {
    started(); signal.addEventListener('abort', () => { aborted(); reject(Error('Cancelled test runtime')); }, { once: true });
  }) });
  const app = express(); app.use('/sample', route.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/sample`;
  t.after(async () => { await route.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  const post = signal => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...(signal ? { signal } : {}) });
  return { route, post, entered, cancelled };
}

test('sample capacity blocks a second run and server shutdown cancels the owned runtime', async t => {
  const x = await setup(t); const pending = x.post(); await x.entered;
  assert.equal((await x.post()).status, 409);
  await x.route.close(); await x.cancelled;
  assert.equal((await pending).status, 409); assert.equal((await x.post()).status, 409);
});

test('HTTP disconnect propagates cancellation to the owned source/scope runtime', async t => {
  const x = await setup(t); const controller = new AbortController();
  const pending = x.post(controller.signal); const rejected = assert.rejects(pending);
  await x.entered; controller.abort(); await rejected; await x.cancelled;
});

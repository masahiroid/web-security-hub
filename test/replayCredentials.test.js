'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const childProcess = require('child_process');
const { siteDir, writeSiteConfig, writeEnvFile } = require('../core/siteConfig');

test('UI replay passes site credentials to child environment without logging them', async () => {
  const id = `test-replay-${process.pid}`;
  const dir = siteDir(id);
  const originalSpawn = childProcess.spawn;
  const servicePath = require.resolve('../server/services/replayService');
  let child, invocation;
  try {
    writeSiteConfig(id, { baseUrl: 'http://127.0.0.1:4180/en/apply', outputDir: '.golden-master' });
    writeEnvFile(id, { LOGIN_USER: 'replay-user', LOGIN_PASS: 'replay-secret', BASIC_USER: 'basic-user', BASIC_PASS: 'basic-secret' });
    fs.mkdirSync(path.join(dir, '.golden-master', 'session-test'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.golden-master/session-test/generated.spec.ts'), '// fixture');
    childProcess.spawn = (...args) => {
      invocation = args;
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      return child;
    };
    delete require.cache[servicePath];
    const { startReplay } = require(servicePath);
    const logs = [];
    const replay = startReplay({ siteId: id, sessionId: 'session-test', options: { recordBaseline: true }, onLog: l => logs.push(l) });
    const env = invocation[2].env;
    assert.equal(invocation[0], process.execPath);
    assert.equal(env.WEB_SECURITY_HUB_PLAYWRIGHT_TEST, require.resolve('playwright/test'));
    assert(!invocation[1].includes('--prefix'));
    assert.equal(env.GOLDEN_MASTER_LOGIN_USER, 'replay-user');
    assert.equal(env.GOLDEN_MASTER_LOGIN_PASS, 'replay-secret');
    assert.equal(env.GOLDEN_MASTER_BASIC_PASS, 'basic-secret');
    assert(invocation[1].includes('--update-snapshots'));
    assert(invocation[1].includes(path.join(dir, '.golden-master/session-test/test-results')));
    assert(!logs.join('\n').includes('replay-secret'));
    child.emit('close', 0);
    assert.equal((await replay.completed).ok, true);
  } finally {
    childProcess.spawn = originalSpawn;
    delete require.cache[servicePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

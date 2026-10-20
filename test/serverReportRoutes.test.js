'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('Express 5 serves default reports and nested assets through all session routes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-report-routes-'));
  const previous = process.env.WEB_SECURITY_HUB_DATA_DIR;
  process.env.WEB_SECURITY_HUB_DATA_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.WEB_SECURITY_HUB_DATA_DIR;
    else process.env.WEB_SECURITY_HUB_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  const site = path.join(root, 'sites', 'fixture');
  await fs.mkdir(site, { recursive: true });
  await fs.writeFile(path.join(site, 'site.config.json'), JSON.stringify({ outputDir: '.golden-master' }));
  const fixtures = [
    { directory: path.join(site, '.golden-master', 'session-1'), route: '/api/sites/fixture/sessions/session-1/', report: 'report.html' },
    { directory: path.join(site, 'explore-sessions', 'session-1'), route: '/api/sites/fixture/explore-sessions/session-1/', report: 'explore-report.html' },
    { directory: path.join(root, 'artifacts', 'test-sessions', 'session-1'), route: '/api/test-sessions/session-1/', report: 'report.html' },
  ];
  for (const fixture of fixtures) {
    await fs.mkdir(path.join(fixture.directory, 'screenshots'), { recursive: true });
    await fs.writeFile(path.join(path.dirname(fixture.directory), 'outside.html'), 'private outside content');
    await fs.mkdir(fixture.directory + '-other', { recursive: true });
    await fs.writeFile(path.join(fixture.directory + '-other', 'secret.txt'), 'private sibling content');
    await fs.writeFile(path.join(fixture.directory, fixture.report), `report:${fixture.route}`);
    await fs.writeFile(path.join(fixture.directory, 'screenshots', 'image.txt'), 'nested asset');
  }
  // Loading the complete application also detects invalid Express 5 route patterns.
  const app = require('../server');
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(async () => {
    await app.get('closeVerifier')();
    await new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
  });
  const origin = `http://127.0.0.1:${listener.address().port}`;
  for (const fixture of fixtures) {
    for (const suffix of ['', fixture.report]) {
      const response = await fetch(origin + fixture.route + suffix);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), `report:${fixture.route}`);
    }
    const asset = await fetch(origin + fixture.route + 'screenshots/image.txt');
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'nested asset');
    assert.equal((await fetch(origin + fixture.route + 'missing.html')).status, 404);
    assert.equal((await fetch(origin + fixture.route.replace('session-1', '..%2fother'))).status, 400);
    assert([400, 404].includes((await fetch(origin + fixture.route + '..%2foutside.html')).status));
    assert([400, 404].includes((await fetch(origin + fixture.route + '..%2fsession-1-other%2fsecret.txt')).status));
  }
  const { FILE_SERVING_LIMITS } = require('../server/lib/fileServingPolicy');
  let limited;
  for (let index = 0; index <= FILE_SERVING_LIMITS.limit; index++) {
    const response = await fetch(origin + fixtures[0].route);
    await response.text();
    if (response.status === 429) { limited = response; break; }
  }
  assert.equal(limited?.status, 429);
  assert(limited.headers.has('retry-after'));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { BrowserSession } = require('../core/crawler/browser');
const { scanForms, collectNavigation } = require('../core/crawler/formScanner');
const { crawlForForms } = require('../core/crawler/crawler');
const { gotoWithLogin } = require('../core/crawler/login');
const { exploreSite, isDestructiveLabel, DESTRUCTIVE_KEYWORDS } = require('../core/crawler/explorer');

// A small local site drives a real browser; the results are compared with recorded files.
// UPDATE_GOLDEN=1 re-records them. Ports and temporary paths are normalized away.
const GOLDEN = path.join(__dirname, 'golden', 'crawler');
const PAGES = {
  '/': `<!doctype html><title>Home</title><main><h1>Home</h1><a href="/signup">Sign up</a> <a href="/about#team">About</a>
    <a href="/files/manual.pdf">Manual</a> <a href="mailto:a@example.test">Mail</a> <a href="https://elsewhere.invalid/x">External</a>
    <button id="menu" onclick="document.getElementById('panel').hidden=false">Menu</button><div id="panel" hidden>Panel</div>
    <button>Delete account</button></main>`,
  '/crawl': `<!doctype html><title>Crawl</title><main><h1>Crawl</h1><a href="/about#team">About</a> <a href="/files/manual.pdf">Manual</a>
    <a href="mailto:a@example.test">Mail</a> <a href="https://elsewhere.invalid/x">External</a> <a href="/crawl#same">Self</a>
    <button type="button" onclick="location.href='/signup'">Go</button></main>`,
  '/gate': `<!doctype html><title>Gate</title><main><form id="gate"><input type="checkbox" name="agree" id="agree"><label for="agree">I agree to the terms</label>
    <button type="button" onclick="location.href='/signup'">Next</button></form><a href="/terms">Terms</a><a href="/about">About</a></main>`,
  '/useronly': `<!doctype html><title>User</title><main><form method="post" action="/useronly"><input name="user" type="text"><button type="submit">Next</button></form></main>`,
  '/stuck': `<!doctype html><title>Stuck</title><main><form method="post" action="/stuck"><input name="user" type="text"><input name="pass" type="password"><button type="submit">Login</button></form></main>`,
  '/about': `<!doctype html><title>About</title><main><h2>About</h2><a href="/">Home</a><a href="/terms">Terms</a>
    <div data-href="/mypage" role="button" onclick="location.href='/mypage'">My page</div></main>`,
  '/terms': '<!doctype html><title>Terms</title><main><h1>Terms</h1></main>',
  '/mypage': '<!doctype html><title>My page</title><main><h1>Mine</h1><a href="/logout">Log out</a></main>',
  '/signup': `<!doctype html><title>Sign up</title><main><form id="signup" action="/done" method="post">
    <label for="email">Mail address</label><input id="email" name="email" type="email" required maxlength="40">
    <input name="age" type="number" min="18" max="99" step="1"><select name="plan"><option value="a">A plan</option><option value="b">B plan</option></select>
    <input type="checkbox" name="agree_terms" id="agree"><label for="agree">I agree to the terms</label>
    <input name="secret" type="hidden" value="x"><input type="submit" value="Join"></form>
    <input name="search" placeholder="Search"><button>Find</button><a href="/terms">Terms</a></main>`,
  '/done': '<!doctype html><title>Done</title><main><h1>Done</h1></main>',
  '/login': `<!doctype html><title>Login</title><main><form method="post" action="/login"><input name="user" type="text">
    <input name="pass" type="password"><button type="submit">Login</button></form></main>`,
  '/secret': '<!doctype html><title>Secret</title><main><h1>Secret area</h1><form><input name="note"><button>Save</button></form></main>',
};

function startSite() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const signedIn = /(?:^|;\s*)sid=1/.test(request.headers.cookie || '');
    if (request.method === 'POST' && url.pathname === '/login') {
      response.writeHead(302, { 'set-cookie': 'sid=1; Path=/', location: '/secret' }); return response.end();
    }
    if (request.method === 'POST' && (url.pathname === '/stuck' || url.pathname === '/useronly')) { response.writeHead(200, { 'content-type': 'text/html' }); return response.end(PAGES[url.pathname]); }
    if (request.method === 'POST') { response.writeHead(302, { location: '/done' }); return response.end(); }
    if (url.pathname === '/secret' && !signedIn) { response.writeHead(302, { location: '/login' }); return response.end(); }
    const body = PAGES[url.pathname];
    if (!body) { response.writeHead(404, { 'content-type': 'text/html' }); return response.end('<!doctype html><title>Missing</title>missing'); }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(body);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function normalize(value, origin) {
  const text = JSON.stringify(value, null, 2).split(origin).join('http://SITE');
  return text.replace(/[\w./\\:-]*wsh-crawler-[\w-]+/g, '<tmp>').replace(/127-0-0-1-\d+/g, 'SITE') + '\n';
}

function compare(name, value, origin) {
  const file = path.join(GOLDEN, name);
  const actual = normalize(value, origin);
  if (process.env.UPDATE_GOLDEN === '1') { fs.mkdirSync(GOLDEN, { recursive: true }); fs.writeFileSync(file, actual); }
  assert.equal(actual, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), name);
}

test('crawler modules behave as recorded in a real browser', async (t) => {
  const site = await startSite();
  const origin = `http://127.0.0.1:${site.address().port}`;
  const session = new BrowserSession({ headful: false });
  const page = await session.start();
  const lines = [];
  const log = line => lines.push(line.split(origin).join('http://SITE'));
  t.after(async () => { await session.stop(); site.close(); });

  await t.test('forms and navigation are scanned', async () => {
    await page.goto(`${origin}/signup`);
    compare('scan-forms.json', await scanForms(page), origin);
    await page.goto(`${origin}/`);
    compare('navigation.json', await collectNavigation(page), origin);
    await page.goto(`${origin}/about`);
    compare('navigation-about.json', await collectNavigation(page), origin);
    await page.setContent('<main><input name="q" placeholder="free"><button>Go</button></main>');
    compare('scan-standalone.json', await scanForms(page), origin);
  });

  await t.test('the crawler follows same-site links, probes clicks and snapshots pages', async () => {
    const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-crawler-shots-'));
    const result = await crawlForForms(page, `${origin}/crawl`, { maxDepth: 1, maxPages: 6, sameOriginOnly: true, screenshotDir: shots }, log);
    compare('crawl.json', result, origin);
    compare('crawl-shots.json', fs.readdirSync(shots).sort(), origin);
    compare('crawl-log.json', lines, origin);
    const small = await crawlForForms(page, `${origin}/crawl`, { maxDepth: 0, maxPages: 1, sameOriginOnly: true }, () => {});
    assert.equal(small.visited.length, 1);
    const unreachable = await crawlForForms(page, 'http://127.0.0.1:9/', { maxDepth: 1, maxPages: 2, sameOriginOnly: true }, () => {});
    assert.deepEqual(unreachable.forms, []);
  });

  await t.test('an agreement gate hides policy links from the crawl', async () => {
    const gatePage = await session.newPage();
    const gateLines = [];
    const result = await crawlForForms(gatePage, `${origin}/gate`, { maxDepth: 1, maxPages: 5, sameOriginOnly: true }, line => gateLines.push(line.split(origin).join('http://SITE')));
    compare('gate.json', { visited: result.visited, formCount: result.forms.length, log: gateLines.filter(line => /agreement-gate/.test(line)) }, origin);
    await gatePage.close();
  });

  await t.test('login is handled and failures are explicit', async () => {
    const loginPage = await session.newPage();
    const loginLines = [];
    await gotoWithLogin(loginPage, `${origin}/secret`, { username: 'u', password: 'p' }, line => loginLines.push(line.split(origin).join('http://SITE')));
    assert.equal(loginPage.url(), `${origin}/secret`);
    compare('login-log.json', loginLines, origin);
    await assert.rejects(() => gotoWithLogin(loginPage, `${origin}/stuck`, { username: 'u', password: 'p' }, () => {}), /Password field still visible/);
    await assert.rejects(() => gotoWithLogin(loginPage, `${origin}/useronly`, { username: 'u', password: 'p', loginUrl: `${origin}/useronly` }, () => {}), /Could not locate the password field/);
    await loginPage.context().clearCookies();
    await gotoWithLogin(loginPage, `${origin}/`, undefined, () => {});
    assert.equal(loginPage.url(), `${origin}/`);
    await loginPage.close();
  });

  await t.test('exploration clicks safe controls and reports destructive ones', async () => {
    const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'wsh-crawler-explore-'));
    const exploreLines = [];
    const result = await exploreSite(session, `${origin}/`, { maxPages: 3, maxDepth: 1, maxClicksPerPage: 4, screenshotDir: shots }, line => exploreLines.push(line.split(origin).join('http://SITE')));
    compare('explore.json', result, origin);
    compare('explore-shots.json', fs.readdirSync(shots).sort(), origin);
    compare('explore-log.json', exploreLines, origin);
  });

  await t.test('destructive labels are recognised', () => {
    assert.equal(isDestructiveLabel('Please DELETE this'), true);
    assert.equal(isDestructiveLabel('Read more'), false);
    assert.ok(DESTRUCTIVE_KEYWORDS.includes('送信') && DESTRUCTIVE_KEYWORDS.length > 20);
  });
});

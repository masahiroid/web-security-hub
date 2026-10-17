'use strict';
const { writeSiteConfig, writeEnvFile, readEnvFile, readSiteConfig } = require('../core/siteConfig');
function setup({ reset = process.argv.includes('--reset') } = {}) {
  for (const lang of ['ja', 'en']) {
    const id = `training-${lang}`;
    let existing;
    try { existing = readSiteConfig(id); } catch { /* first install */ }
    if (existing && !reset) {
      const env = readEnvFile(id);
      const missing = {};
      if (!env.LOGIN_USER) missing.LOGIN_USER = 'learner@example.test';
      if (!env.LOGIN_PASS) missing.LOGIN_PASS = 'training-only';
      if (Object.keys(missing).length) writeEnvFile(id, missing);
      console.log(`${id}: kept existing configuration; ensured demo credentials (use setup --reset to reset training sites)`);
      continue;
    }
    writeSiteConfig(id, {
      displayName: lang === 'ja' ? '研修ラボ（日本語）' : 'Training Lab (English)',
      baseUrl: `http://127.0.0.1:4180/${lang}/dashboard`,
      labels: ['training'], ruleSpecDir: 'rule-spec', outputDir: '.golden-master',
      crawl: { maxDepth: 1, maxPages: 3, maxCasesPerForm: 4, dryRun: false, fastFail: false },
      login: { loginUrl: `http://127.0.0.1:4180/${lang}/login`, usernameSelector: '#email', passwordSelector: '#password', submitSelector: '#sign-in' },
      scenario: { steps: [{ action: 'goto', url: `http://127.0.0.1:4180/${lang}/apply` }] }
    });
    writeEnvFile(id, { LOGIN_USER: 'learner@example.test', LOGIN_PASS: 'training-only' });
    console.log(`${id}: ready`);
  }
}
async function main() {
  const action = process.argv[2] || 'setup';
  if (action === 'setup') return setup();
  const endpoint = action === 'reset' ? 'reset' : 'mode';
  if (!['reset', 'baseline', 'changed', 'fixed'].includes(action)) throw new Error('Usage: npm run training:setup | npm run training:mode -- baseline|changed|fixed|reset');
  const r = await fetch(`http://127.0.0.1:4180/__training/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: action }) });
  if (!r.ok) throw new Error(await r.text());
  console.log(await r.json());
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { setup };

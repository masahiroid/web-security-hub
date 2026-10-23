#!/usr/bin/env node
'use strict';
const { buildRunnerConfig } = require('../siteConfig');
const { JsonStore } = require('../store/jsonStore');
const { runFormGeneration } = require('../runner/formRunner');
const { writeHtmlReport } = require('../report/htmlReport');
const { writeMarkdownReport } = require('../report/markdownReport');
const { writeTestCasesYaml } = require('../codegen/testCaseYaml');
const site = process.argv[process.argv.indexOf('--site') + 1];
if (!site || site === '--site') { console.error('Usage: npm run autoflow -- --site <siteId>'); process.exit(1); }
(async () => {
  const { runnerConfig, outputBaseDir, sessionId } = buildRunnerConfig(site);
  const store = new JsonStore(outputBaseDir, sessionId);
  const result = await runFormGeneration(runnerConfig, store, (line) => console.log(`[runner] ${String(line).replace(/\n|\r/g, '')}`));
  writeTestCasesYaml(store.location); writeHtmlReport(store.location); writeMarkdownReport(store.location);
  console.log(JSON.stringify({ sessionId, ...result }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { renderDesktopCourse } = require('../desktop/courseRenderer');
for (const lang of ['ja','en']) {
  test(`managed ${lang} course uses GUI actions while preserving scenarios and images`, () => {
    const original = fs.readFileSync(path.join(__dirname,`../docs/training/README${lang==='ja'?'.ja':''}.html`),'utf8');
    const html = renderDesktopCourse(original,{lang,origin:'http://127.0.0.1:45001',port:45001});
    assert(!html.includes('npm install'));
    assert(!html.includes('npm run training:mode'));
    assert(!html.includes('npx playwright install'));
    assert(html.includes('data-start-training'));
    for (const mode of ['baseline','changed','fixed','reset']) assert(html.includes(`data-training-mode="${mode}"`));
    assert(html.includes('/?trainingScan=before'));
    assert(html.includes('/?trainingScan=after'));
    assert(html.includes('T02'));
    assert(html.includes('T09'));
    assert(html.includes('T11'));
    assert(html.includes(lang === 'ja' ? '<strong>45001</strong>' : 'port 45001'));
    assert(!html.includes('http://127.0.0.1:4173'));
    assert(html.includes('13-sast-before.png'));
    assert(html.includes('&quot;steps&quot;'));
    assert(original.includes('npm install'), 'Source/CLI course remains intact');
  });
}

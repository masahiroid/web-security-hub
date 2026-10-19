'use strict';
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const root = path.resolve(__dirname, '..');
async function startServers() {
  const servers = [];
  try {
    for (const [modulePath, port] of [['training/sample-site/server', 4180], ['server/index', 4173]]) {
      const server = require(path.join(root, modulePath)).listen(port, '127.0.0.1');
      servers.push(server);
      await once(server, 'listening');
    }
  } catch (error) {
    await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
    throw new Error(`Training automation requires free ports 4173 and 4180: ${error.message}`, { cause: error });
  }
  return async () => Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
}
async function setMode(mode) {
  const response = await fetch('http://127.0.0.1:4180/__training/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (!response.ok) throw new Error(await response.text());
}
function writeEvidence(name, data) {
  const dir = path.join(root, 'artifacts/training'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n');
}
module.exports = { root, startServers, setMode, writeEvidence };

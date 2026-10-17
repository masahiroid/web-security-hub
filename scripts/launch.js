'use strict';
const { spawn } = require('child_process');
async function main() {
  const { createHost } = require('../desktop/host');
  const host = await createHost();
  console.log(`Web Security Hub: ${host.url}`);
  if (!process.argv.includes('--no-open')) {
    const [command, args] = process.platform === 'darwin' ? ['open', [host.url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', host.url]] : ['xdg-open', [host.url]];
    const browser = spawn(command, args, { stdio:'ignore',windowsHide:true });
    browser.on('error', () => console.log('Open the URL above in your browser.'));
  }
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await host.close(); process.exit(0); });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

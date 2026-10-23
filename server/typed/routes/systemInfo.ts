import express from 'express';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { DEFAULTS, SERVER } from '../config';
import { PACKAGE_INFO } from '../packageInfo';
import { PROJECT_ROOT } from '../paths';
import { apiRateLimit } from '../lib/rateLimit';

const BYTES_PER_GIB = 1024 ** 3;
const field = (source: unknown, name: string): unknown => source && typeof source === 'object' ? Reflect.get(source, name) : undefined;

function safeExec(command: string): string | undefined {
  try { return execSync(command, { encoding: 'utf8', timeout: DEFAULTS.commandTimeoutMs }).trim(); } catch { return undefined; }
}
function playwrightVersion(): unknown {
  try { return field(require('playwright/package.json'), 'version'); } catch { return undefined; }
}
const gib = (bytes: number) => Math.round((bytes / BYTES_PER_GIB) * 10) / 10;
/** What the running environment looks like; shown in the "System information" dialog. */
export function createSystemInfoRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.get('/system-info', (_request, response) => {
    response.json({
      app: { name: PACKAGE_INFO.name, version: PACKAGE_INFO.version, root: PROJECT_ROOT },
      node: { version: process.version, execPath: process.execPath },
      npm: { version: safeExec('npm -v') },
      playwright: { version: playwrightVersion() },
      os: { platform: os.platform(), release: os.release(), arch: os.arch(), type: os.type(), cpus: os.cpus().length, totalMemGB: gib(os.totalmem()), freeMemGB: gib(os.freemem()), hostname: os.hostname() },
      server: { pid: process.pid, port: process.env.PORT || SERVER.defaultPort, uptimeSec: Math.round(process.uptime()) },
    });
  });
  return router;
}

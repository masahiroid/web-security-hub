import express from 'express';
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { ZAP_RUNTIME } from '../domain/zapRuntimeConfig';
import { ZAP } from '../domain/zap';
import { installZapRuntime, readZapInstallation } from './zapRuntimeInstall';

/** Authenticated by the parent verifier router. The client cannot supply URLs/paths. */
export function createZapRuntimeRoute(dataRoot: string) {
  const router = express.Router(); let active: { controller: AbortController; completion: Promise<void> } | undefined; let closing = false;
  router.get('/', async (_req, res) => {
    const installed = Boolean(await readZapInstallation(dataRoot));
    res.json({ installed, installing: Boolean(active), version: ZAP.version,
      downloadBytes: ZAP_RUNTIME.zap.bytes + Math.max(...Object.values(ZAP_RUNTIME.java).map(asset => asset.bytes)),
      licenseUrls: ['https://www.zaproxy.org/docs/desktop/start/features/license/', 'https://adoptium.net/about/'] });
  });
  router.post('/install', express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return void res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' });
    if (active || closing) return void res.status(HTTP_STATUS.conflict).json({ error: 'busy' });
    const controller = new AbortController(); const cancel = () => controller.abort(); res.once('close', cancel);
    const task = { controller, completion: Promise.resolve() }; active = task;
    task.completion = installZapRuntime(dataRoot, controller.signal).then(() => {
      if (!res.destroyed) res.json({ installed: true, version: ZAP.version });
    }).catch(() => { if (!res.destroyed) res.status(HTTP_STATUS.conflict).json({ error: 'installation_incomplete' }); })
      .finally(() => { res.removeListener('close', cancel); if (active === task) active = undefined; });
  });
  return { router, async close() { closing = true; active?.controller.abort(); await active?.completion; } };
}

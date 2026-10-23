import express from 'express';
import { scanDynamic } from '../../../core/security/dynamicScanner';
import { ZapClient } from '../../../core/security/zapClient';
import { buildSiteScenario } from '../../../core/scenario/siteScenario';
import { apiRateLimit } from '../lib/rateLimit';
import { HTTP_STATUS } from '../config';
import { bodyOf, isRecord, messageOf } from '../lib/http';
import { runStaticScan } from '../services/staticScanService';

const AUTHORIZATION_REQUIRED = '対象システムの診断許可を確認してください';
/** Dynamic assessment, ZAP reachability and static analysis. Nothing starts without the caller's confirmed authorization. */
export function createSecurityRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.post('/security/dynamic-scan', async (request, response) => {
    const { targetUrl, maxPages, maxDepth, allowActiveScan, authorizationConfirmed, scenario, zap, siteId, useSiteScenario } = bodyOf(request);
    if (!authorizationConfirmed) return void response.status(HTTP_STATUS.badRequest).json({ error: AUTHORIZATION_REQUIRED });
    try {
      const saved = useSiteScenario ? buildSiteScenario(typeof siteId === 'string' ? siteId : undefined) : undefined;
      const target = targetUrl || saved?.targetUrl;
      response.json(await scanDynamic({ targetUrl: typeof target === 'string' ? target : undefined, maxPages, maxDepth, allowActiveScan, scenario: saved?.scenario || scenario, zap }));
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.post('/security/zap-status', async (request, response) => {
    try {
      const options = bodyOf(request).zap;
      const zap = new ZapClient(isRecord(options) ? { ...(typeof options.baseUrl === 'string' ? { baseUrl: options.baseUrl } : {}), ...(typeof options.apiKey === 'string' ? { apiKey: options.apiKey } : {}) } : undefined);
      response.json({ ok: true, baseUrl: zap.baseUrl, ...(await zap.version()) });
    } catch (error: unknown) { response.status(HTTP_STATUS.unavailable).json({ error: `ZAP に接続できません: ${messageOf(error)}` }); }
  });
  router.post('/security/static-scan', (request, response) => {
    try {
      const sourceDir = bodyOf(request).sourceDir;
      if (typeof sourceDir !== 'string') throw new Error('読み取り可能なソースディレクトリを指定してください');
      response.json(runStaticScan(sourceDir));
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}

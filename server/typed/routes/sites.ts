import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { listSites, listSitesByFolder, mergeSiteConfig, readEnvFile, readSiteConfig, siteDir, writeEnvFile, writeSiteConfig } from '../../../core/siteConfig';
import type { SiteConfig } from '../../../core/siteConfig';
import { listDataSets, readDataSet, writeDataSet } from '../../../core/scenario/dataDriven';
import { listSharedSteps, writeSharedSteps } from '../../../core/scenario/sharedSteps';
import { normalizeStoredScenario } from '../../../core/scenario/siteScenario';
import { listSecretVariableNames, secretEnvKey } from '../../../core/scenario/variables';
import { DEFAULTS, HTTP_STATUS, PATTERNS } from '../config';
import { bodyOf, isRecord, messageOf, param } from '../lib/http';

function existingConfig(siteId: string): SiteConfig {
  try { return readSiteConfig(siteId); } catch { return {}; }
}
function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}
/** Site settings, credentials, variables, shared steps and data sets. Secrets are written but never read back. */
export function createSitesRoutes(): express.Router {
  const router = express.Router();
  router.get('/sites', (_request, response) => {
    const sites = listSites().map(id => {
      const config = readSiteConfig(id);
      return { id, displayName: config.displayName, baseUrl: config.baseUrl, folder: config.folder || '', labels: config.labels || [] };
    });
    response.json({ sites });
  });
  router.get('/sites-by-folder', (_request, response) => { response.json({ folders: listSitesByFolder() }); });
  router.get('/sites/:id', (request, response) => {
    try { response.json({ config: readSiteConfig(param(request, 'id')) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.notFound).json({ error: messageOf(error) }); }
  });
  // A partial submission must not erase fields the caller did not mention, so the update merges onto the stored config.
  router.put('/sites/:id', (request, response) => {
    try {
      const siteId = param(request, 'id');
      const { credentials, ...rest } = bodyOf(request);
      const incoming: Record<string, unknown> = { ...rest };
      if (Object.hasOwn(incoming, 'scenario')) incoming.scenario = normalizeStoredScenario(incoming.scenario);
      writeSiteConfig(siteId, mergeSiteConfig(existingConfig(siteId), incoming));
      if (credentials && typeof credentials === 'object') writeEnvFile(siteId, credentials as Record<string, unknown>);
      response.json({ ok: true });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.post('/sites/:id/credentials', (request, response) => {
    try { writeEnvFile(param(request, 'id'), bodyOf(request)); response.json({ ok: true }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/credentials/status', (request, response) => {
    try {
      const env = readEnvFile(param(request, 'id'));
      response.json({ hasLoginUser: Boolean(env.LOGIN_USER), hasLoginPass: Boolean(env.LOGIN_PASS), hasBasicUser: Boolean(env.BASIC_USER), hasBasicPass: Boolean(env.BASIC_PASS) });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/rule-specs', (request, response) => {
    try {
      const siteId = param(request, 'id');
      const config = readSiteConfig(siteId);
      const directory = path.resolve(siteDir(siteId), typeof config.ruleSpecDir === 'string' && config.ruleSpecDir ? config.ruleSpecDir : DEFAULTS.ruleSpecDirectory);
      const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => PATTERNS.ruleSpecFile.test(name)) : [];
      response.json({ dir: directory, files });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  // Standard variables come back with values; secret variables only by name, so a GET can populate a form safely.
  router.get('/sites/:id/variables', (request, response) => {
    try {
      const siteId = param(request, 'id');
      response.json({ standard: readSiteConfig(siteId).variables || {}, secretNames: listSecretVariableNames(siteId) });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.put('/sites/:id/variables', (request, response) => {
    try {
      const siteId = param(request, 'id');
      const { standard, secrets } = bodyOf(request);
      if (standard !== undefined) {
        const variables = requireObject(standard, 'standard variables must be an object');
        writeSiteConfig(siteId, mergeSiteConfig(existingConfig(siteId), { variables }));
      }
      if (secrets !== undefined) {
        const values = requireObject(secrets, 'secret variables must be an object');
        writeEnvFile(siteId, Object.fromEntries(Object.entries(values).map(([name, value]) => [secretEnvKey(name), value])));
      }
      response.json({ ok: true });
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/shared-steps', (request, response) => {
    try { response.json({ groups: listSharedSteps(param(request, 'id')) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.put('/sites/:id/shared-steps', (request, response) => {
    try { writeSharedSteps(param(request, 'id'), bodyOf(request).groups || []); response.json({ ok: true }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/data-sets', (request, response) => {
    try { response.json({ names: listDataSets(param(request, 'id')) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.get('/sites/:id/data-sets/:name', (request, response) => {
    try { response.json({ rows: readDataSet(param(request, 'id'), param(request, 'name')) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.put('/sites/:id/data-sets/:name', (request, response) => {
    try { writeDataSet(param(request, 'id'), param(request, 'name'), bodyOf(request).rows || []); response.json({ ok: true }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  return router;
}

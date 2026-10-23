import express from 'express';
import { AuthSessionCapture, hasStorageState } from '../../../core/scenario/authSession';
import { readSiteConfig } from '../../../core/siteConfig';
import { HTTP_STATUS } from '../config';
import { bodyOf, messageOf, param } from '../lib/http';

/** Saves the result of a manual sign-in so later crawls start signed in. Authorization is required to start. */
export function createAuthSessionRoutes(): express.Router {
  const router = express.Router();
  const capture = new AuthSessionCapture();
  router.get('/auth-session/status', (_request, response) => { response.json(capture.status()); });
  router.get('/sites/:id/auth-session/saved', (request, response) => {
    try { response.json({ saved: hasStorageState(param(request, 'id')) }); }
    catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.post('/auth-session/start', async (request, response) => {
    try {
      const { siteId, authorized } = bodyOf(request);
      if (!authorized) throw new Error('explicit authorization is required before opening a login session');
      if (typeof siteId !== 'string' || !siteId.trim()) throw new Error('siteId is required');
      const site = readSiteConfig(siteId.trim());
      response.json(await capture.start({ siteId: siteId.trim(), startUrl: site.baseUrl }));
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.post('/auth-session/stop', async (_request, response) => {
    try { response.json(await capture.stop()); }
    catch (error: unknown) { response.status(HTTP_STATUS.internalError).json({ error: messageOf(error) }); }
  });
  router.post('/auth-session/cancel', async (_request, response) => {
    try { response.json(await capture.cancel()); }
    catch (error: unknown) { response.status(HTTP_STATUS.internalError).json({ error: messageOf(error) }); }
  });
  return router;
}

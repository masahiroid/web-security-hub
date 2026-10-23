import express from 'express';
import { PlaywrightScenarioRecorder } from '../../../core/scenario/playwrightRecorder';
import { HTTP_STATUS } from '../config';
import { bodyOf, messageOf } from '../lib/http';

/** Records a person's actions in one visible browser as a reviewable scenario. Authorization is required to start. */
export function createScenarioRecorderRoutes(): express.Router {
  const router = express.Router();
  const recorder = new PlaywrightScenarioRecorder();
  router.get('/scenario-recorder/status', (_request, response) => { response.json(recorder.status()); });
  router.post('/scenario-recorder/start', async (request, response) => {
    try {
      const { siteId, authorized, includeInputValues } = bodyOf(request);
      if (!authorized) throw new Error('explicit authorization is required before recording');
      if (typeof siteId !== 'string' || !siteId.trim()) throw new Error('siteId is required');
      response.json(await recorder.start({ siteId: siteId.trim(), includeInputValues }));
    } catch (error: unknown) { response.status(HTTP_STATUS.badRequest).json({ error: messageOf(error) }); }
  });
  router.post('/scenario-recorder/stop', async (_request, response) => {
    try { response.json(await recorder.stop()); }
    catch (error: unknown) { response.status(HTTP_STATUS.internalError).json({ error: messageOf(error) }); }
  });
  return router;
}

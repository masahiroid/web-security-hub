import express from 'express';
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { runSastFixture } from './sastFixtureService';

/** One finite sample at a time; disconnect and shutdown cancel its owned runtime. */
export function createSastSampleRoute({ run = runSastFixture }: { run?: typeof runSastFixture } = {}) {
  let active: { controller: AbortController; completion: Promise<void> } | undefined;
  let closing = false;
  const router = express.Router();
  router.post('/', express.json({ limit: LIMITS.jsonPayloadBytes }), (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      res.status(HTTP_STATUS.badRequest).json({ error: 'invalid_options' }); return;
    }
    if (active || closing) { res.status(HTTP_STATUS.conflict).json({ error: 'busy' }); return; }
    const controller = new AbortController(); const cancel = () => controller.abort();
    res.once('close', cancel);
    const task = { controller, completion: Promise.resolve() };
    active = task;
    task.completion = run(controller.signal).then(result => {
      if (!res.destroyed) res.json(result);
    }).catch(() => {
      if (!res.destroyed) res.status(HTTP_STATUS.conflict).json({ error: 'sample_incomplete' });
    }).finally(() => { res.removeListener('close', cancel); if (active === task) active = undefined; });
  });
  return { router, async close() { closing = true; active?.controller.abort(); await active?.completion; } };
}

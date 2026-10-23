import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { REPORT_ROOT } from '../../../core/security/staticReport';
import { HTTP_STATUS } from '../config';
import { param } from '../lib/http';
import { apiRateLimit } from '../lib/rateLimit';

const RUN_ID = /^sast-[0-9]{14}(?:-[0-9]+)?$/;
const REPORT_FILE = /^(report\.(html|md|sarif)|sast-result\.json)$/;

/** Serves the saved static-analysis reports; only run IDs and file names that the analysis itself produces are accepted. */
export function createStaticReportsRoutes(): express.Router {
  const router = express.Router();
  router.use(apiRateLimit());
  router.get('/security/static-scans/:runId/:file', (request, response) => {
    const runId = param(request, 'runId');
    const file = param(request, 'file');
    if (!RUN_ID.test(runId) || !REPORT_FILE.test(file)) return void response.status(HTTP_STATUS.badRequest).json({ error: 'invalid report path' });
    const target = path.join(REPORT_ROOT, runId, file);
    if (!fs.existsSync(target)) return void response.status(HTTP_STATUS.notFound).json({ error: 'report not found' });
    response.sendFile(target);
  });
  return router;
}

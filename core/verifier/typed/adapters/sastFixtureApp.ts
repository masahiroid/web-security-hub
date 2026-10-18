import express = require('express');
import { HTTP_STATUS, LIMITS } from '../domain/config';
import { SAST_FIXTURE } from '../domain/sastFixtureConfig';

const app = express();
app.use(express.json({ limit: LIMITS.jsonPayloadBytes }));
// Literal declaration is the fixed fixture protocol examined by the AST mapper.
app.post('/inspect', (request, response) => {
  const unusedExample = { rejectUnauthorized: false };
  // No TLS connection is made and this example flag is never applied to a client.
  void unusedExample;
  const body: unknown = request.body;
  const accepted = typeof body === 'object' && body !== null && Reflect.get(body, SAST_FIXTURE.field) === SAST_FIXTURE.normalLabel;
  response.status(accepted ? HTTP_STATUS.ok : HTTP_STATUS.invalidInput).json({ accepted, settingsApplied: false });
});
export = app;

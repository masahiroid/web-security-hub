'use strict';
const Ajv = require('ajv');
const { CONTRACT_VERSION, LIMITS, ID_PATTERN, DIGEST_PATTERN, POINTS, FIXTURE } = require('../generated/domain/config');
const { REPORT_STORAGE } = require('../generated/domain/campaignConfig');
const { campaignSchemas } = require('../generated/adapters/campaignSchemas');
const { sastSchemas } = require('../generated/adapters/sastSchemas');
const { assertSastMetadata } = require('../generated/domain/sastMapping');
const { assertReportIntegrity } = require('../generated/domain/reportIntegrity');
const ajv = new Ajv({ strict: true, ownProperties: true });
const id = { type: 'string', pattern: ID_PATTERN };
const text = { type: 'string', maxLength: 2048 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const version = { const: CONTRACT_VERSION };
const nullableNumber = { type: ['number', 'null'], minimum: 0 };
const schemas = {
  slice: object({ schemaVersion: version, findingInstanceId: id, sourceRootId: id, relativePath: { type: 'string', maxLength: LIMITS.routeLength }, sourceDigest: { type: 'string', pattern: DIGEST_PATTERN }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, mapping: { enum: ['verified', 'ambiguous', 'unavailable'] } }),
  evidence: object({ schemaVersion: version, evidenceId: id, seedId: id, sourceDigest: { type: 'string', pattern: DIGEST_PATTERN }, kind: { enum: ['server-event', 'business-oracle', 'http-observation'] }, summary: text }),
  seed: object({ schemaVersion: version, seedId: id, values: { type: 'object', maxProperties: 32, propertyNames: id, additionalProperties: { anyOf: [{ type: 'string', maxLength: 4096 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } }, omitFields: { type: 'array', maxItems: 32, uniqueItems: true, items: id }, rationale: text }),
  scope: object({ schemaVersion: version, sourceRootId: id, origin: { type: 'string', maxLength: 200 }, route: { type: 'string', pattern: '^/[^?#]*$', maxLength: LIMITS.routeLength }, method: { enum: ['GET', 'POST'] }, authProfileIds: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: id }, allowedFields: { type: 'array', maxItems: 32, uniqueItems: true, items: id }, ttlMs: { type: 'integer', minimum: 1, maximum: 3600000 }, maxTrials: { type: 'integer', minimum: 1, maximum: 1000 }, maxConcurrency: { type: 'integer', minimum: 1, maximum: 4 } }),
  feedback: object({ schemaVersion: version, seedId: id, outcome: { enum: ['completed', 'timeout', 'cancelled', 'error'] }, status: { type: ['integer', 'null'], minimum: 100, maximum: 599 }, durationMs: nullableNumber, instrumentation: { enum: ['verified', 'unavailable'] }, reachability: { enum: ['observed', 'not_observed', 'unavailable'] }, sourceDigest: { type: ['string', 'null'], pattern: DIGEST_PATTERN }, oracle: { enum: ['passed', 'violated', 'inconclusive'] }, controlPassed: { type: 'boolean' }, evidenceIds: { type: 'array', maxItems: LIMITS.feedbackEvidenceCount, uniqueItems: true, items: id }, zap: { enum: ['disabled', 'completed', 'incomplete', 'error'] } }),
  assessment: object({ schemaVersion: version, seedId: id, result: { enum: ['reproduced', 'no_issue_observed_in_scope', 'under_investigation'] }, vexStatus: { const: 'under_investigation' }, draft: { const: true }, evidenceIds: { type: 'array', maxItems: LIMITS.feedbackEvidenceCount, items: id } })
};
const scalarValues = schemas.seed.properties.values;
schemas.trialRequest = object({ url: { type: 'string', maxLength: 700 }, method: { enum: ['GET', 'POST'] }, authProfileId: id, seed: schemas.seed });
schemas.profile = object({ schemaVersion: version, profileId: id, origin: { type: 'string', maxLength: 200 }, setup: { type: 'array', maxItems: LIMITS.profileSetupSteps, items: object({ route: { type: 'string', maxLength: LIMITS.routeLength }, method: { const: 'POST' }, values: scalarValues, expectedStatus: { type: 'integer', minimum: 200, maximum: 299 } }) } });
schemas.control = object({ schemaVersion: version, origin: { type: 'string', maxLength: 200 }, route: { type: 'string', maxLength: LIMITS.routeLength }, method: { enum: ['GET', 'POST'] }, seed: schemas.seed, expectedStatus: { type: 'integer', minimum: 200, maximum: 299 }, expectedJson: { ...scalarValues, minProperties: 1 } });
schemas.httpObservation = object({ schemaVersion: version, jobId: id, trialId: id, requestId: id, seedId: id, authProfileId: id, purpose: { enum: ['control', 'candidate'] }, executionKind: { const: 'direct-http' }, outcome: { enum: ['completed', 'timeout', 'cancelled', 'error'] }, reason: { enum: ['none', 'transport_error', 'setup_failed', 'redirect_outside_scope', 'redirect_not_followed', 'response_too_large', 'cleanup_failed', 'job_cancelled', 'job_disposed', 'job_expired', 'trial_timeout'] }, status: { type: ['integer', 'null'], minimum: 100, maximum: 599 }, durationMs: { type: 'number', minimum: 0 }, dispatched: { type: 'boolean' }, setupRequests: { type: 'integer', minimum: 0, maximum: LIMITS.profileSetupSteps }, redirect: { enum: ['none', 'blocked', 'not_followed'] } });
// Optional trusted control profile permits a valid owner/confirmed control versus another candidate role.
schemas.control.properties.authProfileId = id;
const correlation = { jobId: id, trialId: id, seedId: id, requestId: id, authProfileId: id };
const serverEvent = object({ ...correlation, evidenceId: id, point: { enum: Object.values(POINTS) }, profile: { enum: FIXTURE.roles }, recordId: { type: ['string', 'null'], maxLength: LIMITS.identifierLength }, oracle: { enum: ['passed', 'violated', 'inconclusive'] }, sourceDigest: { type: 'string', pattern: DIGEST_PATTERN }, mode: { enum: FIXTURE.modes } });
schemas.serverSnapshot = object({ schemaVersion: version, sourceDigest: { type: 'string', pattern: DIGEST_PATTERN }, instrumentation: { enum: ['verified', 'unavailable'] }, complete: { type: 'boolean' }, events: { type: 'array', maxItems: LIMITS.evidenceEvents, items: serverEvent } });
Object.assign(schemas, campaignSchemas(schemas, id, serverEvent));
Object.assign(schemas, sastSchemas);
const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, ajv.compile(schema)]));
function cloneJson(value, depth = 0, seen = new Set()) {
  if (depth > 20) throw Error('JSON nesting limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) throw Error('Expected finite acyclic JSON');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Expected plain JSON object');
  seen.add(value);
  const output = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('Forbidden JSON key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) throw Error('Expected JSON data property');
    output[key] = cloneJson(descriptor.value, depth + 1, seen);
  }
  if (Array.isArray(value) && (Object.keys(output).length !== value.length || Object.keys(output).some((key, i) => key !== String(i)))) throw Error('Expected dense array');
  seen.delete(value);
  return Object.freeze(output);
}
function validate(name, input) {
  if (!Object.hasOwn(validators, name)) throw Error('Unknown contract');
  const maximumBytes = name === 'report' ? REPORT_STORAGE.maximumBytes : LIMITS.jsonPayloadBytes;
  if (typeof input === 'string' && Buffer.byteLength(input) > maximumBytes) throw Error('JSON size limit');
  const value = cloneJson(typeof input === 'string' ? JSON.parse(input) : input);
  if (Buffer.byteLength(JSON.stringify(value)) > maximumBytes) throw Error('JSON size limit');
  if (!validators[name](value)) throw Error(`Invalid ${name}: ${ajv.errorsText(validators[name].errors)}`);
  if (name === 'report') assertReportIntegrity(value, { validate, assess });
  if (name === 'sastMetadata') assertSastMetadata(value);
  if (name === 'slice' && value.endLine < value.startLine) throw Error('Invalid line range');
  if (name === 'seed' && value.omitFields.some(key => Object.hasOwn(value.values, key))) throw Error('Field cannot be supplied and omitted');
  if (name === 'feedback') {
    if (value.instrumentation === 'unavailable' && (value.reachability !== 'unavailable' || value.sourceDigest !== null)) throw Error('Unavailable instrumentation has no reachability evidence');
    if (value.instrumentation === 'verified' && (!value.sourceDigest || value.reachability === 'unavailable')) throw Error('Verified instrumentation needs digest and observation');
    if (value.oracle === 'violated' && !value.evidenceIds.length) throw Error('Violation needs evidence');
  }
  return value;
}
function assess(input) {
  const f = validate('feedback', input);
  const complete = f.outcome === 'completed' && f.controlPassed && !['incomplete', 'error'].includes(f.zap);
  const result = complete && f.instrumentation === 'verified' && f.reachability === 'observed' && f.oracle === 'violated' ? 'reproduced' : complete && f.oracle === 'passed' ? 'no_issue_observed_in_scope' : 'under_investigation';
  return validate('assessment', { schemaVersion: 1, seedId: f.seedId, result, vexStatus: 'under_investigation', draft: true, evidenceIds: f.evidenceIds });
}
module.exports = { schemas: cloneJson(schemas), validate, assess };

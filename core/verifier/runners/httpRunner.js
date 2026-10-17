'use strict';
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { request } = require('playwright');
const { validate, assess } = require('../contracts');

function exactOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.origin !== origin) throw Error('Numeric loopback origin required');
}
function routeAt(origin, route) {
  const url = new URL(route, origin);
  if (!route.startsWith('/') || route.includes('\\') || route.includes('%') || url.origin !== origin || url.pathname !== route || url.search || url.hash) throw Error('Invalid trusted route');
  return origin + route;
}
const targetKey = ({ origin, route, method }) => JSON.stringify([origin, route, method]);

// Catalogs are supplied by the trusted backend, never by a seed/provider.
function createHttpRunner({ registry, profiles, controls = [], timeoutMs = 5000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid trial timeout');
  const catalog = new Map();
  for (const input of profiles) {
    const profile = validate('profile', input);
    exactOrigin(profile.origin);
    for (const step of profile.setup) routeAt(profile.origin, step.route);
    if (catalog.has(profile.profileId)) throw Error('Duplicate profile');
    catalog.set(profile.profileId, profile);
  }
  const normalControls = new Map();
  for (const input of controls) {
    const control = validate('control', input);
    validate('seed', control.seed);
    exactOrigin(control.origin); routeAt(control.origin, control.route);
    const key = targetKey(control);
    if (normalControls.has(key)) throw Error('Duplicate control');
    normalControls.set(key, control);
  }
  function preflight(handle, input) {
    const trial = validate('trialRequest', input);
    registry.check(handle, trial);
    const profile = catalog.get(trial.authProfileId);
    if (!profile || new URL(trial.url).origin !== profile.origin) throw Error('Profile not registered for target');
    return { trial, profile };
  }
  async function execute(handle, input, purpose) {
    const { trial: inputTrial, profile } = preflight(handle, input);
    const grant = registry.begin(handle, inputTrial);
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const record = { schemaVersion: 1, jobId: handle.jobId, trialId: grant.trialId, requestId, seedId: grant.seed.seedId, authProfileId: inputTrial.authProfileId, purpose, executionKind: 'direct-http', outcome: 'error', reason: 'transport_error', status: null, durationMs: 0, dispatched: false, setupRequests: 0, redirect: 'none' };
    let context;
    let closePromise;
    let stopReason;
    let body = null;
    let requestTimeoutReason = 'trial_timeout';
    function close() {
      if (context && !closePromise) closePromise = context.dispose({ reason: 'Verifier trial finished' });
      // Rejection is handled again by finally; don't leak an unhandled rejection.
      closePromise?.catch(() => {});
      return closePromise;
    }
    function stop(reason) { if (!stopReason) stopReason = reason; close(); }
    function jobAborted() {
      let state;
      try { state = registry.status(handle).state; } catch { state = 'disposed'; }
      stop(state === 'cancelled' ? 'job_cancelled' : state === 'disposed' ? 'job_disposed' : 'job_expired');
    }
    grant.signal.addEventListener('abort', jobAborted, { once: true });
    const timer = setTimeout(() => stop('trial_timeout'), timeoutMs);
    function assertRunning() {
      if (grant.signal.aborted && !stopReason) jobAborted();
      if (stopReason) throw Error('Trial interrupted');
    }
    async function send(url, method, values, headers) {
      assertRunning();
      const trialRemaining = timeoutMs - (performance.now() - started);
      const jobRemaining = grant.expiresAt - Date.now();
      requestTimeoutReason = jobRemaining <= trialRemaining ? 'job_expired' : 'trial_timeout';
      const remaining = Math.min(trialRemaining, jobRemaining);
      if (remaining <= 0) { stop(requestTimeoutReason); assertRunning(); }
      return context.fetch(url, {
        method, ...(method === 'GET' ? { params: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])) } : { data: JSON.stringify(values), headers: { 'Content-Type': 'application/json', ...headers } }),
        ...(method === 'GET' ? { headers } : {}),
        maxRedirects: 0, maxRetries: 0, failOnStatusCode: false, timeout: remaining
      });
    }
    try {
      assertRunning();
      context = await request.newContext({ ignoreHTTPSErrors: false });
      assertRunning();
      for (const step of profile.setup) {
        record.setupRequests++;
        const response = await send(routeAt(profile.origin, step.route), step.method, step.values, {});
        const status = response.status();
        await response.dispose();
        if (status !== step.expectedStatus) { record.reason = 'setup_failed'; throw Error('Setup failed'); }
      }
      assertRunning();
      record.dispatched = true;
      const response = await send(inputTrial.url, inputTrial.method, grant.seed.values, {
        'X-Verifier-Job-Id': handle.jobId, 'X-Verifier-Trial-Id': grant.trialId,
        'X-Verifier-Seed-Id': grant.seed.seedId, 'X-Verifier-Request-Id': requestId
      });
      record.status = response.status();
      if (record.status >= 300 && record.status < 400 && response.headers().location) {
        record.redirect = 'blocked';
        record.reason = 'redirect_outside_scope';
        try {
          registry.assertRedirect(handle, new URL(response.headers().location, inputTrial.url).href);
          record.redirect = 'not_followed'; record.reason = 'redirect_not_followed';
        } catch { /* Never follow an unapproved redirect, or echo its potentially secret URL. */ }
      } else {
        const buffer = await response.body();
        if (buffer.length > 65536) record.reason = 'response_too_large';
        else {
          // This value is private to the trusted control checker, never exported.
          try { body = JSON.parse(buffer.toString('utf8')); } catch { /* HTTP observations can be non-JSON. */ }
          record.outcome = 'completed'; record.reason = 'none';
        }
      }
      await response.dispose();
      assertRunning();
    } catch (error) {
      // Transport errors can contain cookies, request bodies and URLs: never return them.
      if (!stopReason && error?.name === 'TimeoutError') stop(requestTimeoutReason);
    } finally {
      clearTimeout(timer);
      grant.signal.removeEventListener('abort', jobAborted);
      try { await close(); } catch { record.outcome = 'error'; record.reason = 'cleanup_failed'; }
      try { registry.finish(handle, grant.trialId); } catch { /* dispose already removed the entire job */ }
      if (stopReason) {
        record.reason = stopReason;
        record.outcome = ['trial_timeout', 'job_expired'].includes(stopReason) ? 'timeout' : 'cancelled';
      }
      record.durationMs = Math.max(0, performance.now() - started);
    }
    const observation = validate('httpObservation', record);
    const feedback = validate('feedback', { schemaVersion: 1, seedId: grant.seed.seedId, outcome: record.outcome, status: record.status, durationMs: record.durationMs, instrumentation: 'unavailable', reachability: 'unavailable', sourceDigest: null, oracle: 'inconclusive', controlPassed: false, evidenceIds: [], zap: 'disabled' });
    return { observation, feedback, body };
  }
  function publicResult(result) {
    return Object.freeze({ observation: result.observation, feedback: result.feedback, assessment: assess(result.feedback) });
  }
  return {
    async run(handle, input) { return publicResult(await execute(handle, input, 'candidate')); },
    async runPair(handle, input) {
      const { trial } = preflight(handle, input);
      const url = new URL(trial.url);
      const control = normalControls.get(targetKey({ origin: url.origin, route: url.pathname, method: trial.method }));
      if (!control) throw Error('No trusted normal control for target');
      const controlInput = { ...trial, seed: control.seed };
      preflight(handle, controlInput);
      const normal = await execute(handle, controlInput, 'control');
      const passed = normal.observation.outcome === 'completed' && normal.observation.status === control.expectedStatus && normal.body !== null && typeof normal.body === 'object' && Object.entries(control.expectedJson).every(([key, value]) => Object.hasOwn(normal.body, key) && normal.body[key] === value);
      if (!passed) return Object.freeze({ state: 'control_failed', control: publicResult(normal), candidate: null });
      const candidate = await execute(handle, trial, 'candidate');
      candidate.feedback = validate('feedback', { ...candidate.feedback, controlPassed: true });
      return Object.freeze({ state: 'completed', control: publicResult(normal), candidate: publicResult(candidate) });
    }
  };
}
module.exports = { createHttpRunner };

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validate } = require('../contracts');
function createRegistry({ roots, authProfileIds, now = Date.now }) {
  const catalog = Object.fromEntries(Object.entries(roots).map(([id, root]) => [id, fs.realpathSync(root)]));
  const profiles = new Set(authProfileIds);
  const jobs = new Map();
  function get(handle, active = true) {
    const job = jobs.get(handle?.jobId);
    const hash = crypto.createHash('sha256').update(String(handle?.capability || '')).digest();
    if (!job || !crypto.timingSafeEqual(hash, job.hash)) throw Error('Invalid job capability');
    if (active && (job.cancelled || now() >= job.expiresAt)) throw Error('Job cancelled or expired');
    return job;
  }
  return {
    create(input) {
      const scope = validate('scope', input);
      const url = new URL(scope.origin);
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.origin !== scope.origin) throw Error('Exact numeric loopback origin required');
      if (!Object.hasOwn(catalog, scope.sourceRootId) || scope.authProfileIds.some(id => !profiles.has(id))) throw Error('Unregistered root or profile');
      if (new URL(scope.route, scope.origin).pathname !== scope.route || new URL(scope.route, scope.origin).origin !== scope.origin || scope.route.includes('\\') || scope.route.includes('%')) throw Error('Invalid route');
      const capability = crypto.randomBytes(32).toString('hex');
      const jobId = crypto.randomUUID();
      jobs.set(jobId, { scope, hash: crypto.createHash('sha256').update(capability).digest(), expiresAt: now() + scope.ttlMs, trials: 0, running: new Set(), cancelled: false });
      return Object.freeze({ jobId, capability });
    },
    begin(handle, { url, method, authProfileId, seed: input }) {
      const job = get(handle);
      const seed = validate('seed', input);
      const s = job.scope;
      if (url !== s.origin + s.route || method !== s.method || !s.authProfileIds.includes(authProfileId)) throw Error('Trial outside grant');
      if ([...Object.keys(seed.values), ...seed.omitFields].some(key => !s.allowedFields.includes(key))) throw Error('Field outside grant');
      if (job.trials >= s.maxTrials || job.running.size >= s.maxConcurrency) throw Error('Execution budget exhausted');
      const trialId = crypto.randomUUID();
      job.trials++; job.running.add(trialId);
      return Object.freeze({ trialId, seed, scope: s });
    },
    finish(handle, trialId) { get(handle, false).running.delete(trialId); },
    cancel(handle) { get(handle, false).cancelled = true; },
    assertRedirect(handle, url) { const s = get(handle).scope; if (url !== s.origin + s.route) throw Error('Redirect outside grant'); },
    sourceFile(handle, relative) {
      const job = get(handle);
      if (typeof relative !== 'string' || /(^|[\\/])(\.\.|\.git|node_modules|artifacts|internal)([\\/]|$)|(^|[\\/])\.env|^[a-zA-Z]:|^[/\\]/i.test(relative) || !/\.(js|cjs|mjs)$/.test(relative)) throw Error('Source path denied');
      const root = catalog[job.scope.sourceRootId];
      const file = fs.realpathSync(path.resolve(root, relative));
      const rel = path.relative(root, file);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(file).isFile() || fs.statSync(file).size > 1048576) throw Error('Source outside grant');
      return file;
    }
  };
}
module.exports = { createRegistry };

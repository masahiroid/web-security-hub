'use strict';
const fs = require('fs');
const path = require('path');
const { siteDir } = require('../siteConfig');

const MAX_EXPANSION_DEPTH = 5;

function sharedStepsFile(siteId) {
  return path.join(siteDir(siteId), 'shared-steps.json');
}

/** Returns the site's shared step groups: [{ name, steps: [...] }]. */
function listSharedSteps(siteId) {
  const file = sharedStepsFile(siteId);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('shared-steps.json must contain an array');
  return parsed;
}

function writeSharedSteps(siteId, groups) {
  if (!Array.isArray(groups)) throw new Error('shared steps must be an array');
  for (const group of groups) {
    if (!group || typeof group.name !== 'string' || !group.name.trim()) throw new Error('each shared step group requires a name');
    if (!Array.isArray(group.steps)) throw new Error(`shared step group "${group.name}" requires a steps array`);
  }
  fs.mkdirSync(siteDir(siteId), { recursive: true });
  fs.writeFileSync(sharedStepsFile(siteId), JSON.stringify(groups, null, 2) + '\n', 'utf8');
}

/**
 * Expands `useSharedStep` references within `steps` into their underlying step
 * sequences, recursively (so a shared step group may itself reference another
 * one), guarding against cycles/unbounded nesting via MAX_EXPANSION_DEPTH.
 */
function expandSharedSteps(steps, siteId, depth = 0) {
  if (!Array.isArray(steps)) return [];
  if (depth > MAX_EXPANSION_DEPTH) throw new Error('shared step expansion exceeded max depth (possible cycle)');
  const groups = listSharedSteps(siteId);
  const out = [];
  for (const step of steps) {
    if (step && step.action === 'useSharedStep') {
      const group = groups.find((g) => g.name === step.name);
      if (!group) throw new Error(`shared step not found: ${step.name}`);
      out.push(...expandSharedSteps(group.steps, siteId, depth + 1));
    } else {
      out.push(step);
    }
  }
  return out;
}

module.exports = { listSharedSteps, writeSharedSteps, expandSharedSteps };

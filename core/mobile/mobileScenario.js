'use strict';

const ACTIONS = new Set(['tap', 'fill', 'wait', 'waitForSelector', 'swipe', 'screenshot', 'loop']);
const MAX_STEPS = 50;
const MAX_LOOP_TIMES = 200;
const MAX_NESTING_DEPTH = 5;

function normalizeMobileSteps(steps, depth = 0) {
  if (steps === undefined) return [];
  if (!Array.isArray(steps)) throw new Error('mobileScenario.steps must be an array');
  if (steps.length > MAX_STEPS) throw new Error(`mobile scenario can contain at most ${MAX_STEPS} steps`);
  return steps.map((step, index) => normalizeMobileStep(step, index, depth));
}

function normalizeMobileStep(step, index, depth) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`mobile scenario step ${index + 1} must be an object`);
  if (!ACTIONS.has(step.action)) throw new Error(`mobile scenario step ${index + 1} has an unsupported action`);

  if (step.action === 'tap' || step.action === 'waitForSelector') {
    if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`mobile scenario step ${index + 1} requires selector`);
    return { action: step.action, selector: step.selector.trim() };
  }
  if (step.action === 'fill') {
    if (typeof step.selector !== 'string' || !step.selector.trim()) throw new Error(`mobile scenario step ${index + 1} requires selector`);
    return { action: 'fill', selector: step.selector.trim(), value: String(step.value ?? '') };
  }
  if (step.action === 'wait') {
    return { action: 'wait', value: Math.min(Math.max(Number(step.value) || 500, 0), 10_000) };
  }
  if (step.action === 'swipe') {
    const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return { action: 'swipe', fromX: toNum(step.fromX), fromY: toNum(step.fromY), toX: toNum(step.toX), toY: toNum(step.toY) };
  }
  if (step.action === 'screenshot') {
    if (typeof step.saveAs !== 'string' || !step.saveAs.trim()) throw new Error(`mobile scenario step ${index + 1} requires saveAs`);
    return { action: 'screenshot', saveAs: step.saveAs.trim() };
  }
  if (step.action === 'loop') {
    if (depth >= MAX_NESTING_DEPTH) throw new Error(`mobile scenario step ${index + 1}: loop nesting exceeded max depth`);
    const times = Math.min(Math.max(Number(step.times) || 0, 0), MAX_LOOP_TIMES);
    return { action: 'loop', times, steps: normalizeMobileSteps(step.steps, depth + 1) };
  }
  throw new Error(`mobile scenario step ${index + 1} has an unsupported action`);
}

module.exports = { ACTIONS, normalizeMobileSteps };

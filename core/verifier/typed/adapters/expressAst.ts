import { parse, type AnyNode, type Program } from 'acorn';
import { SAST_MAPPING } from '../domain/sastMapping';
import type { SourceRange } from '../domain/sastMapping';

export class AstLimit extends Error {}
export type FunctionNode = Extract<AnyNode, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;
export function isFunction(node: AnyNode): node is FunctionNode { return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type); }
function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string' &&
    'start' in value && typeof value.start === 'number' && 'end' in value && typeof value.end === 'number';
}
export function children(node: AnyNode): AnyNode[] {
  const result: AnyNode[] = [];
  for (const value of Object.values(node) as unknown[]) {
    if (isNode(value)) result.push(value);
    else if (Array.isArray(value)) for (const item of value as unknown[]) if (isNode(item)) result.push(item);
  }
  return result;
}
export function nodes(root: AnyNode, skipNestedFunctions = false): AnyNode[] {
  const pending = [root]; const result: AnyNode[] = []; const seen = new Set<AnyNode>();
  while (pending.length) {
    const node = pending.pop(); if (!node || seen.has(node)) continue; seen.add(node);
    if (skipNestedFunctions && node !== root && isFunction(node)) continue;
    result.push(node); if (result.length > SAST_MAPPING.maximumNodes) throw new AstLimit();
    pending.push(...children(node));
  }
  return result;
}
export function parseModule(source: string, extension: string): { program: Program; comments: SourceRange[] } {
  const options = { ecmaVersion: SAST_MAPPING.ecmaVersion, locations: true } as const;
  function attempt(sourceType: 'module' | 'commonjs') {
    const comments: SourceRange[] = [];
    const program = parse(source, { ...options, sourceType, onComment: (_block, _text, start, end) => { comments.push({ start, end }); } });
    return { program, comments };
  }
  if (extension === '.cjs') return attempt('commonjs');
  if (extension === '.mjs') return attempt('module');
  try { return attempt('module'); } catch { return attempt('commonjs'); }
}
export function literal(node: AnyNode | undefined): string | undefined { return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined; }
export function member(node: AnyNode | undefined): { object: AnyNode; name: string } | undefined {
  if (node?.type !== 'MemberExpression' || node.computed || node.optional || node.property.type !== 'Identifier') return undefined;
  return { object: node.object, name: node.property.name };
}
export function bindingNames(node: AnyNode): string[] {
  switch (node.type) {
    case 'Identifier': return [node.name];
    case 'RestElement': return bindingNames(node.argument);
    case 'AssignmentPattern': return bindingNames(node.left);
    case 'ArrayPattern': return node.elements.flatMap(item => item ? bindingNames(item) : []);
    case 'ObjectPattern': return node.properties.flatMap(item => item.type === 'RestElement' ? bindingNames(item.argument) : bindingNames(item.value));
    default: return [];
  }
}

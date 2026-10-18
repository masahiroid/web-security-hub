import type { AnyNode } from 'acorn';
import { SAST_MAPPING, type StaticFunction } from '../domain/sastMapping';
import { AstLimit, bindingNames, children, isFunction, type FunctionNode } from './expressAst';

export function propertyLabel(node: AnyNode, parent: AnyNode | undefined): boolean {
  if (parent?.type === 'MemberExpression') return !parent.computed && parent.property === node;
  if (parent?.type === 'Property') return !parent.computed && !parent.shorthand && parent.key === node;
  if (parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') return !parent.computed && parent.key === node;
  return false;
}
/** Direct local calls with conservative shadow/escape handling, without evaluation. */
export function indexStaticFunctions(all: readonly AnyNode[], top: readonly AnyNode[]) {
  const definitions = all.filter(isFunction); if (definitions.length > SAST_MAPPING.maximumFunctions) throw new AstLimit();
  const parents = new Map<AnyNode, AnyNode>(); for (const node of all) for (const child of children(node)) parents.set(child, node);
  const named = new Map<string, FunctionNode>(); const references = new Set<AnyNode>(); let duplicate = false;
  function register(name: string, fn: FunctionNode, binding: AnyNode): void { if (named.has(name)) duplicate = true; named.set(name, fn); references.add(binding); }
  for (const node of top) {
    if (node.type === 'FunctionDeclaration' && node.id) register(node.id.name, node, node.id);
    if (node.type === 'VariableDeclaration' && node.kind === 'const') for (const declaration of node.declarations) if (declaration.id.type === 'Identifier' && declaration.init && isFunction(declaration.init)) register(declaration.id.name, declaration.init, declaration.id);
  }
  const owners = new Map<AnyNode, FunctionNode | null>(); const owned = new Map<number, AnyNode[]>();
  function owner(node: AnyNode): FunctionNode | null {
    let cursor = node; const trail: AnyNode[] = []; let found: FunctionNode | null = null;
    while (true) {
      if (owners.has(cursor)) { found = owners.get(cursor) ?? null; break; }
      trail.push(cursor); const parent = parents.get(cursor);
      if (!parent) break;
      if (isFunction(parent)) { found = parent; break; }
      cursor = parent;
    }
    for (const visited of trail) owners.set(visited, found); return found;
  }
  for (const node of all) { const fn = owner(node); if (fn) { const list = owned.get(fn.start) ?? []; list.push(node); owned.set(fn.start, list); } }
  const functions: StaticFunction[] = definitions.map(fn => {
    const body = owned.get(fn.start) ?? [];
    const shadows = new Set([...fn.params.flatMap(bindingNames), ...body.flatMap(node => node.type === 'VariableDeclarator' ? bindingNames(node.id) : node.type === 'CatchClause' && node.param ? bindingNames(node.param) : [])]);
    if (fn.type === 'FunctionExpression' && fn.id) shadows.add(fn.id.name);
    for (const node of body) if (node.type === 'FunctionDeclaration' && node.id || node.type === 'ClassDeclaration' && node.id) shadows.add(node.id.name);
    const calls = body.flatMap(node => {
      if (node.type !== 'CallExpression' || node.optional || node.callee.type !== 'Identifier' || shadows.has(node.callee.name)) return [];
      const target = named.get(node.callee.name); if (!target) return [];
      references.add(node.callee); return [target.start];
    });
    return { id: fn.start, start: fn.start, end: fn.end, line: fn.loc?.start.line ?? 1, calls: [...new Set(calls)] };
  });
  return { functions, named, references, parents, duplicate };
}

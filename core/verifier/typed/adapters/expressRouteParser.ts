import type { AnyNode } from 'acorn';
import { SAST_MAPPING, staticPath, type ExpressGraph, type MappingReason, type RouteMethod, type StaticMiddleware, type StaticMount, type StaticRoute } from '../domain/sastMapping';
import { AstLimit, bindingNames, isFunction, literal, member, nodes, parseModule } from './expressAst';
import { indexStaticFunctions, propertyLabel } from './staticFunctionGraph';

/** Parse source as data. No require/import from the scanned project is evaluated. */
export function parseExpressRoutes(source: string, extension: string): ExpressGraph {
  const { program, comments } = parseModule(source, extension); const all = nodes(program);
  const top = program.body.map(node => node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node);
  const namespace = new Set<string>(); const appFactories = new Set<string>(); const routerFactories = new Set<string>();
  const topBindings = top.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations.flatMap(item => bindingNames(item.id)) : node.type === 'FunctionDeclaration' && node.id ? [node.id.name] : []);
  const requireIsGlobal = !topBindings.includes('require') && !top.some(node => node.type === 'ImportDeclaration' && node.specifiers.some(item => item.local.name === 'require'));
  function expressRequire(node: AnyNode | undefined): boolean {
    return requireIsGlobal && node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 && literal(node.arguments[0]) === 'express';
  }
  for (const node of top) {
    if (node.type === 'ImportDeclaration' && literal(node.source) === 'express') for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') { namespace.add(specifier.local.name); appFactories.add(specifier.local.name); }
      if (specifier.type === 'ImportNamespaceSpecifier') namespace.add(specifier.local.name);
      if (specifier.type === 'ImportSpecifier' && (specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value) === 'Router') routerFactories.add(specifier.local.name);
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'const') for (const declaration of node.declarations) if (expressRequire(declaration.init ?? undefined)) {
      if (declaration.id.type === 'Identifier') { namespace.add(declaration.id.name); appFactories.add(declaration.id.name); }
      if (declaration.id.type === 'ObjectPattern') for (const property of declaration.id.properties) if (property.type === 'Property' && !property.computed && property.key.type === 'Identifier' && property.key.name === 'Router' && property.value.type === 'Identifier') routerFactories.add(property.value.name);
    }
  }
  function expressNamespace(node: AnyNode): boolean { return node.type === 'Identifier' && namespace.has(node.name) || expressRequire(node); }
  const units = new Set<string>(); const roots: string[] = []; const allowedUnitReferences = new Set<AnyNode>();
  for (const node of top) if (node.type === 'VariableDeclaration' && node.kind === 'const') for (const declaration of node.declarations) {
    const init = declaration.init; if (declaration.id.type !== 'Identifier' || init?.type !== 'CallExpression' || init.arguments.length) continue;
    const callee = init.callee; const property = member(callee);
    const application = callee.type === 'Identifier' && appFactories.has(callee.name) || expressRequire(callee);
    const router = callee.type === 'Identifier' && routerFactories.has(callee.name) || property?.name === 'Router' && expressNamespace(property.object);
    if (application || router) { units.add(declaration.id.name); allowedUnitReferences.add(declaration.id); if (application) roots.push(declaration.id.name); }
  }
  const functionIndex = indexStaticFunctions(all, top); const { named } = functionIndex;
  let incomplete: MappingReason | null = functionIndex.duplicate ? 'unsupported_registration' : null;
  const routes: StaticRoute[] = []; const mounts: StaticMount[] = []; const middleware: StaticMiddleware[] = [];
  function handlers(items: readonly AnyNode[]): number[] {
    const ids: number[] = [];
    for (const item of items) {
      if (isFunction(item)) ids.push(item.start);
      else if (item.type === 'Identifier' && named.has(item.name)) { const fn = named.get(item.name); if (fn) { ids.push(fn.start); functionIndex.references.add(item); } }
      else if (item.type === 'ArrayExpression' && item.elements.every(element => element !== null && element.type !== 'SpreadElement')) ids.push(...handlers(item.elements.filter((element): element is NonNullable<typeof element> => element !== null)));
      else if (item.type === 'CallExpression') {
        const factory = member(item.callee);
        if (!factory || !expressNamespace(factory.object) || !SAST_MAPPING.middlewareFactories.includes(factory.name)) incomplete = 'unsupported_registration';
      } else incomplete = 'unsupported_registration';
    }
    return ids;
  }
  for (const statement of top) {
    // An exported app remains a file-local root; its deployment mount/origin is
    // deliberately not inferred and it never becomes an executable grant.
    if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression') {
      const assignment = statement.expression; const target = member(assignment.left);
      if (assignment.operator === '=' && target?.name === 'exports' && target.object.type === 'Identifier' && target.object.name === 'module' && assignment.right.type === 'Identifier' && roots.includes(assignment.right.name)) allowedUnitReferences.add(assignment.right);
    }
    if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'CallExpression') continue;
    const call = statement.expression; const callee = member(call.callee);
    if (!callee || callee.object.type !== 'Identifier' || !units.has(callee.object.name) || call.optional) continue;
    allowedUnitReferences.add(callee.object); const unit = callee.object.name; const line = call.loc?.start.line ?? 1;
    if (callee.name === 'listen' && roots.includes(unit)) continue;
    const method = callee.name.toUpperCase();
    if (callee.name !== 'use' && !SAST_MAPPING.methods.some(value => value === method)) { incomplete = 'unsupported_registration'; continue; }
    const firstPath = literal(call.arguments[0]); const path = firstPath ?? '/';
    if (callee.name !== 'use' && firstPath === undefined || !staticPath(path)) { incomplete = 'dynamic_registration'; continue; }
    if (callee.name === 'use' && firstPath === undefined) {
      const first = call.arguments[0]; const factory = first?.type === 'CallExpression' ? member(first.callee) : undefined;
      const knownFirst = first && (isFunction(first) || first.type === 'Identifier' && (units.has(first.name) || named.has(first.name)) || first.type === 'ArrayExpression' || factory && expressNamespace(factory.object) && SAST_MAPPING.middlewareFactories.includes(factory.name));
      if (!knownFirst) { incomplete = 'unsupported_registration'; continue; }
    }
    const argumentsAfterPath = firstPath === undefined ? call.arguments : call.arguments.slice(1);
    if (!argumentsAfterPath.length) { incomplete = 'unsupported_registration'; continue; }
    if (callee.name === 'use') {
      const children = argumentsAfterPath.filter(item => item.type === 'Identifier' && units.has(item.name));
      const chain = handlers(argumentsAfterPath.filter(item => !children.includes(item)));
      if (children.length) {
        for (const child of children) if (child.type === 'Identifier') { allowedUnitReferences.add(child); mounts.push({ unit, child: child.name, path, line, handlers: chain }); }
      } else middleware.push({ unit, path, line, handlers: chain });
    } else routes.push({ unit, method: method as RouteMethod, path, line, offset: call.start, handlers: handlers(argumentsAfterPath) });
    if (routes.length + mounts.length + middleware.length > SAST_MAPPING.maximumRoutes) throw new AstLimit();
  }
  // Escapes, computed/chained registrations and conditional/factory registration
  // are deliberately incomplete; a known route cannot hide a second unknown one.
  for (const node of all) {
    if (node.type === 'Identifier' && !propertyLabel(node, functionIndex.parents.get(node))) {
      if (units.has(node.name) && !allowedUnitReferences.has(node)) incomplete ??= 'unsupported_registration';
      if (named.has(node.name) && !functionIndex.references.has(node)) incomplete ??= 'unsupported_registration';
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const affected = node.type === 'AssignmentExpression' ? node.left : node.argument;
      if (nodes(affected).some(item => item.type === 'Identifier' && (namespace.has(item.name) || named.has(item.name) || routerFactories.has(item.name)))) incomplete = 'unsupported_registration';
    }
  }
  const callCallees = all.flatMap(node => node.type === 'CallExpression' || node.type === 'NewExpression' ? [{ start: node.callee.start, end: node.callee.end }] : []);
  return { roots, functions: functionIndex.functions, routes, mounts, middleware, comments, callCallees, incomplete };
}

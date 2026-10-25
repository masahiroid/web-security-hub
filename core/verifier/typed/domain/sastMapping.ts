export const SAST_MAPPING = Object.freeze({
  schemaVersion: 1, identityVersion: 'sast-instance-v1', ecmaVersion: 2024,
  maximumNodes: 100_000, maximumFunctions: 2_000, maximumRoutes: 512,
  maximumExpansions: 4_096, maximumPathLength: 512,
  maximumRelativePathLength: 4_096,
  maximumMetadataBytes: 48 * 1024,
  javascriptExtensions: ['.js', '.cjs', '.mjs'] as readonly string[],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const,
  middlewareFactories: ['json', 'urlencoded', 'raw', 'text', 'static'] as readonly string[]
});
export type RouteMethod = typeof SAST_MAPPING.methods[number];
export type MappingReason = 'unique_static_route' | 'multiple_static_routes' | 'no_static_route' |
  'unsupported_language' | 'parse_error' | 'analysis_limit' | 'unsupported_registration' | 'dynamic_registration' | 'non_code_finding';
export interface SourceRange { readonly start: number; readonly end: number }
export interface SourceSpan {
  readonly startOffset: number; readonly endOffset: number;
  readonly startLine: number; readonly endLine: number;
  readonly startColumn: number; readonly endColumn: number; readonly encoding: 'utf16';
}
export interface StaticFunction { readonly id: number; readonly start: number; readonly end: number; readonly line: number; readonly calls: readonly number[] }
export interface StaticRoute { readonly unit: string; readonly method: RouteMethod; readonly path: string; readonly line: number; readonly offset: number; readonly handlers: readonly number[] }
export interface StaticMount { readonly unit: string; readonly child: string; readonly path: string; readonly line: number; readonly handlers: readonly number[] }
export interface StaticMiddleware { readonly unit: string; readonly path: string; readonly handlers: readonly number[]; readonly line: number }
export interface ExpressGraph {
  readonly roots: readonly string[]; readonly functions: readonly StaticFunction[];
  readonly routes: readonly StaticRoute[]; readonly mounts: readonly StaticMount[];
  readonly middleware: readonly StaticMiddleware[];
  readonly comments: readonly SourceRange[]; readonly callCallees: readonly SourceRange[];
  readonly incomplete: MappingReason | null;
}
export interface RouteReference {
  readonly method: RouteMethod; readonly path: string; readonly registrationLine: number;
  readonly mountLines: readonly number[]; readonly handlerLines: readonly number[];
  readonly middlewareLines: readonly number[]; readonly parameterized: boolean;
}
export interface RouteMapping {
  readonly schemaVersion: number; readonly analysis: 'file-local-express';
  readonly status: 'mapped' | 'ambiguous' | 'unavailable'; readonly reason: MappingReason;
  readonly executable: false; readonly routes: readonly RouteReference[];
}
export interface SastMetadata {
  readonly ruleId: string; readonly findingInstanceId: string; readonly sourceDigest: string;
  readonly relativePath: string; readonly sourceSpan: SourceSpan; readonly routeMapping: RouteMapping;
}
export function assertSastMetadata(value: SastMetadata): void {
  const { sourceSpan: span, routeMapping: mapping, relativePath: path } = value;
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.' || !part)) throw Error('Invalid SAST relative path');
  if (span.endOffset <= span.startOffset || span.endLine < span.startLine || span.endLine === span.startLine && span.endColumn <= span.startColumn) throw Error('Invalid SAST source span');
  if (mapping.status === 'mapped' && (mapping.routes.length !== 1 || mapping.reason !== 'unique_static_route') || mapping.status === 'ambiguous' && (mapping.routes.length < 2 || mapping.reason !== 'multiple_static_routes') || mapping.status === 'unavailable' && ['unique_static_route', 'multiple_static_routes'].includes(mapping.reason)) throw Error('Invalid static mapping conclusion');
  if (mapping.routes.some(route => !staticPath(route.path))) throw Error('Invalid static route template');
}
export function unavailableMapping(reason: MappingReason): RouteMapping {
  return { schemaVersion: SAST_MAPPING.schemaVersion, analysis: 'file-local-express', status: 'unavailable', reason, executable: false, routes: [] };
}
export function staticPath(value: string): boolean {
  return value.length <= SAST_MAPPING.maximumPathLength && /^\/(?:[\p{L}\p{N}_~.:-]+(?:\/[\p{L}\p{N}_~.:-]+)*\/?)?$/u.test(value) &&
    !value.split('/').some(part => part === '.' || part === '..' || part.includes(':') && !/^:[A-Za-z_]\w*$/.test(part));
}
function joinRoute(prefix: string, path: string): string { return `${prefix.replace(/\/$/, '')}/${path.replace(/^\//, '')}`.replace(/\/$/, '') || '/'; }
function beneath(path: string, prefix: string): boolean {
  const target = path.split('/').filter(Boolean); const base = prefix.split('/').filter(Boolean);
  return base.length <= target.length && base.every((part, index) => part === target[index] || part.startsWith(':') || target[index]?.startsWith(':'));
}
/** Declared file-local registrations only. This never grants a target URL or execution. */
export function mapFinding(graph: ExpressGraph, start: number, end: number, invocationRequired = false): RouteMapping {
  if (graph.comments.some(span => span.start <= start && span.end >= end) || invocationRequired && !graph.callCallees.some(span => span.start <= start && span.end > start)) return unavailableMapping('non_code_finding');
  const owner = graph.functions.filter(fn => fn.start <= start && fn.end >= end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  const candidates: RouteReference[] = []; let expansions = 0; let exceeded = false;
  const byId = new Map(graph.functions.map(fn => [fn.id, fn]));
  function reaches(roots: readonly number[]): boolean {
    const pending = [...roots]; const seen = new Set<number>();
    while (pending.length) {
      const id = pending.pop(); if (id === undefined || seen.has(id)) continue;
      if (++expansions > SAST_MAPPING.maximumExpansions) { exceeded = true; return false; }
      seen.add(id); if (id === owner?.id) return true;
      const fn = byId.get(id); if (fn) pending.push(...fn.calls);
    }
    return false;
  }
  type ScopedMiddleware = { path: string; handlers: readonly number[]; line: number };
  function visit(unit: string, prefix: string, inherited: readonly ScopedMiddleware[], mountLines: readonly number[], trail: readonly string[]): void {
    if (++expansions > SAST_MAPPING.maximumExpansions || trail.includes(unit)) { exceeded = true; return; }
    const middleware = [...inherited, ...graph.middleware.filter(item => item.unit === unit).map(item => ({ ...item, path: joinRoute(prefix, item.path) }))];
    for (const route of graph.routes.filter(item => item.unit === unit)) {
      const path = joinRoute(prefix, route.path);
      if (path.length > SAST_MAPPING.maximumPathLength) { exceeded = true; continue; }
      const local = middleware.filter(item => beneath(path, item.path));
      const handlers = [...local.flatMap(item => item.handlers), ...route.handlers];
      if (owner && reaches(handlers)) candidates.push({ method: route.method, path, registrationLine: route.line,
        mountLines: [...mountLines], handlerLines: route.handlers.map(id => byId.get(id)?.line ?? route.line),
        middlewareLines: local.map(item => item.line), parameterized: path.includes(':') });
    }
    for (const mount of graph.mounts.filter(item => item.unit === unit)) {
      const path = joinRoute(prefix, mount.path);
      visit(mount.child, path, [...middleware, { path, handlers: mount.handlers, line: mount.line }], [...mountLines, mount.line], [...trail, unit]);
    }
  }
  for (const root of graph.roots) visit(root, '/', [], [], []);
  if (exceeded) return unavailableMapping('analysis_limit');
  if (graph.incomplete) return { ...unavailableMapping(graph.incomplete), routes: candidates };
  const status = candidates.length === 1 ? 'mapped' : candidates.length > 1 ? 'ambiguous' : 'unavailable';
  return { ...unavailableMapping(candidates.length === 1 ? 'unique_static_route' : candidates.length > 1 ? 'multiple_static_routes' : 'no_static_route'), status, routes: candidates };
}

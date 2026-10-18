import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { DIGEST_ALGORITHM } from '../domain/config';
import { SAST_MAPPING, mapFinding, unavailableMapping, type ExpressGraph, type MappingReason, type SourceSpan } from '../domain/sastMapping';
import { AstLimit } from './expressAst';
import { parseExpressRoutes } from './expressRouteParser';
import { validate } from '../../contracts';

export function createStaticFileAnalysis(bytes: Uint8Array, relativePath: string) {
  const source = Buffer.from(bytes).toString('utf8'); const path = relativePath.replaceAll('\\', '/');
  const sourceDigest = createHash(DIGEST_ALGORITHM).update(bytes).digest('hex'); const extension = extname(path).toLowerCase();
  let graph: ExpressGraph | undefined; let reason: MappingReason = 'unsupported_language';
  let analyzed = false;
  const starts = [0]; for (let offset = 0; offset < source.length; offset++) if (source[offset] === '\n') starts.push(offset + 1);
  function position(offset: number): { line: number; column: number } {
    let low = 0; let high = starts.length;
    while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if ((starts[middle] ?? 0) <= offset) low = middle; else high = middle; }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  }
  return {
    at(ruleId: string, startOffset: number, endOffset: number) {
      if (!ruleId || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > source.length) throw Error('Invalid SAST finding span');
      if (!analyzed) {
        analyzed = true;
        if (SAST_MAPPING.javascriptExtensions.includes(extension)) {
          try { graph = parseExpressRoutes(source, extension); }
          catch (error) { reason = error instanceof AstLimit ? 'analysis_limit' : 'parse_error'; }
        }
      }
      const start = position(startOffset); const end = position(endOffset);
      const sourceSpan: SourceSpan = { startOffset, endOffset, startLine: start.line, endLine: end.line, startColumn: start.column, endColumn: end.column, encoding: 'utf16' };
      const findingInstanceId = `sast-${createHash(DIGEST_ALGORITHM).update(JSON.stringify([SAST_MAPPING.identityVersion, ruleId, path, sourceDigest, startOffset, endOffset])).digest('hex')}`;
      const metadata = { ruleId, findingInstanceId, sourceDigest, relativePath: path, sourceSpan, routeMapping: graph ? mapFinding(graph, startOffset, endOffset, ruleId === 'SAST-DANGEROUS-EVAL') : unavailableMapping(reason) };
      if (Buffer.byteLength(JSON.stringify(metadata)) > SAST_MAPPING.maximumMetadataBytes) metadata.routeMapping = unavailableMapping('analysis_limit');
      return validate('sastMetadata', metadata);
    }
  };
}

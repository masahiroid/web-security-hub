import { isDeepStrictEqual } from 'node:util';
import { LIMITS } from '../domain/config';
import type { SastMetadata } from '../domain/sastMapping';
import type { Scope } from '../domain/types';
import { assertBindingScope, assertSourceTarget, SourceBindingError, type SourceReader, type TrialGuard } from '../domain/sourceBinding';
import { staticMatches } from '../domain/staticRules';
import { createStaticFileAnalysis } from './staticFileAnalysis';

/** Re-read and re-analyze trusted source bytes; never import scanned code. */
export function createSastSourceGuard(source: SourceReader, finding: SastMetadata, scope: Scope): TrialGuard {
  const readSource = source.read.bind(source);
  const guard: TrialGuard = { async verify(grant, input, signal) {
    try {
      signal.throwIfAborted(); assertBindingScope(scope, grant.scope, input);
      const bytes = await readSource(scope.sourceRootId, finding.relativePath, signal);
      signal.throwIfAborted();
      if (bytes.byteLength > LIMITS.sourceFileBytes) throw new SourceBindingError();
      let match: { id: string; startOffset: number; endOffset: number } | undefined;
      for (const item of staticMatches(Buffer.from(bytes).toString('utf8'))) {
        if (item.id === finding.ruleId && item.startOffset === finding.sourceSpan.startOffset && item.endOffset === finding.sourceSpan.endOffset) { match = item; break; }
      }
      if (!match) throw new SourceBindingError();
      const fresh = createStaticFileAnalysis(bytes, finding.relativePath).at(match.id, match.startOffset, match.endOffset);
      if (!isDeepStrictEqual(fresh, finding)) throw new SourceBindingError();
      assertSourceTarget(fresh, scope); signal.throwIfAborted();
    } catch { throw new SourceBindingError(); }
  } };
  return guard;
}

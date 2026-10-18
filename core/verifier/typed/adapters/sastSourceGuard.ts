import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DIGEST_ALGORITHM, LIMITS } from '../domain/config';
import type { SastMetadata } from '../domain/sastMapping';
import type { Scope } from '../domain/types';
import { assertBindingScope, assertSourceTarget, SourceBindingError, type SourceReader, type TrialGuard } from '../domain/sourceBinding';
import { matchesStaticRuleAt } from '../domain/staticRules';
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
      if (createHash(DIGEST_ALGORITHM).update(bytes).digest('hex') !== finding.sourceDigest ||
          !matchesStaticRuleAt(Buffer.from(bytes).toString('utf8'), finding.ruleId, finding.sourceSpan.startOffset, finding.sourceSpan.endOffset)) throw new SourceBindingError();
      const fresh = createStaticFileAnalysis(bytes, finding.relativePath).at(finding.ruleId, finding.sourceSpan.startOffset, finding.sourceSpan.endOffset);
      if (!isDeepStrictEqual(fresh, finding)) throw new SourceBindingError();
      assertSourceTarget(fresh, scope); signal.throwIfAborted();
    } catch { throw new SourceBindingError(); }
  } };
  return guard;
}

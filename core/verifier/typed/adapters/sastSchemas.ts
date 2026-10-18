import { SAST_MAPPING } from '../domain/sastMapping';
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const position = { type: 'integer', minimum: 1 };
const lines = { type: 'array', maxItems: SAST_MAPPING.maximumFunctions, items: position };
export const sastSchemas = {
  sastMetadata: object({
    ruleId: { type: 'string', minLength: 1, maxLength: 128 },
    findingInstanceId: { type: 'string', pattern: '^sast-[a-f0-9]{64}$' },
    sourceDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    relativePath: { type: 'string', minLength: 1, maxLength: SAST_MAPPING.maximumRelativePathLength },
    sourceSpan: object({ startOffset: { type: 'integer', minimum: 0 }, endOffset: { type: 'integer', minimum: 1 }, startLine: position, endLine: position, startColumn: position, endColumn: position, encoding: { const: 'utf16' } }),
    routeMapping: object({ schemaVersion: { const: SAST_MAPPING.schemaVersion }, analysis: { const: 'file-local-express' }, status: { enum: ['mapped', 'ambiguous', 'unavailable'] },
      reason: { enum: ['unique_static_route', 'multiple_static_routes', 'no_static_route', 'unsupported_language', 'parse_error', 'analysis_limit', 'unsupported_registration', 'dynamic_registration', 'non_code_finding'] }, executable: { const: false },
      routes: { type: 'array', maxItems: SAST_MAPPING.maximumRoutes, items: object({ method: { enum: SAST_MAPPING.methods }, path: { type: 'string', maxLength: SAST_MAPPING.maximumPathLength }, registrationLine: position, mountLines: lines, handlerLines: lines, middlewareLines: lines, parameterized: { type: 'boolean' } }) }
    })
  })
};

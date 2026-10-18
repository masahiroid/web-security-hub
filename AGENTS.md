# Working conventions

## Incremental TypeScript and architecture

- Write new verifier production modules in TypeScript under `core/verifier/typed`.
  Keep existing CommonJS entry points as small compatibility facades. Migrate
  other JavaScript modules incrementally when their behavior is covered.
- Keep TypeScript strict. Do not bypass checks with `any`, `@ts-ignore` or
  `@ts-nocheck`. Treat external data as `unknown` and validate at boundaries.
- Use ports and adapters in the verifier: domain modules contain pure rules,
  application services orchestrate use cases, adapters own I/O and external APIs.
  Domain code must not depend on Express, Playwright or filesystem APIs.
- Apply single responsibility to modules/functions. Split lifecycle, transport,
  evidence collection and business decisions instead of growing one runner.
- Give policy limits, timeout values, HTTP codes and fixture settings named,
  documented definitions. Inject bounded operational settings through factories.
  Do not scatter numeric limits, endpoints, paths, credentials or environment
  assumptions through business logic. Fixed protocol vocabulary and explicit
  test vectors are definitions, not user configuration.
- Preserve behavior while refactoring. Run `npm run typecheck`, `npm test` and
  checks appropriate to changed runtime/packaging paths. Build emitted JavaScript
  with `npm run build:verifier`; do not edit or commit generated output.

## Progress and publication

- Read `docs/internal/hybrid-verifier/README.md`, `TASKS.md` and the latest
  `WORKLOG.md` before continuing verifier work, if present locally. Update task
  states and evidence after each completed unit; use roadmap gates for releases.
- Internal documents, credentials, real signing settings and raw evidence stay
  local and must not be staged, uploaded or bundled. Never force-add ignored
  files. Public documentation describes delivered features and limitations.
- Do not add AI provider branding or AI co-author credits to GitHub descriptions,
  commit messages or PRs. Preserve actual API identifiers where required by code.

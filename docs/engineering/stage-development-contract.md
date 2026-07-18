# Stage development contract

Each stage separates business implementation from test implementation and commits them separately. New stage prompts describe only the delta from the current head and must not make temporary Codex environment SHAs permanent repository constraints.

Verifiers validate public contracts, call relationships, runtime results, and invariants—not only function names, variable names, comments, or historic file layouts. When an equivalent implementation replaces an old one, historical verifiers must accept it. Static verifiers prevent structural regressions but never replace database/API E2E. Runtime markers are emitted only after their real assertions pass.

The stage registry is the single source of truth. Business PRs must not include reports, artifacts, or temporary trigger files. Every stage needs business implementation, a static verifier, a runtime scenario, chain registration, and a report manifest. Historical verifiers continue to validate their own behavior after later stages exist; they must not require future-stage files to be absent.

Validation levels are: (1) syntax/typecheck, (2) static verifier, (3) focused API/database runtime, (4) historical regression chain, and (5) report publish verification. Feature work adds only its relevant test delta rather than restating every level.

Verifiers must use registry APIs rather than scan `stage-workflow.ts` or require their filename in `verify-all-local.sh`. Registry configuration is explicit and never inferred from directory traversal. Architecture changes require an anti-pattern scan and migration of every affected historical verifier; `verify-all-local.sh` calls only the registry runner for L24+.

`Prisma.join(values, separator)` separators must be static ordinary strings. Never pass a `Prisma.sql` object as the separator. Every raw SQL builder needs static composition coverage, a PostgreSQL runtime query, an `[object Object]` check, and parameter-binding coverage.

Cross-verifier checks must not depend on another verifier's human-readable error messages, variable names, or irrelevant source formatting. Validate stable contract fields, semantic code blocks, machine markers, or pure-function behavior instead. Changing an assertion message must not make a historical verifier fail when business behavior is unchanged.

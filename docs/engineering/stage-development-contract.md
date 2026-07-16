# Stage development contract

Each stage separates business implementation from test implementation and commits them separately. New stage prompts describe only the delta from the current head and must not make temporary Codex environment SHAs permanent repository constraints.

Verifiers validate public contracts, call relationships, runtime results, and invariants—not only function names, variable names, comments, or historic file layouts. When an equivalent implementation replaces an old one, historical verifiers must accept it. Static verifiers prevent structural regressions but never replace database/API E2E. Runtime markers are emitted only after their real assertions pass.

The stage registry is the single source of truth. Business PRs must not include reports, artifacts, or temporary trigger files. Every stage needs business implementation, a static verifier, a runtime scenario, chain registration, and a report manifest. Historical verifiers continue to validate their own behavior after later stages exist; they must not require future-stage files to be absent.

Validation levels are: (1) syntax/typecheck, (2) static verifier, (3) focused API/database runtime, (4) historical regression chain, and (5) report publish verification. Feature work adds only its relevant test delta rather than restating every level.

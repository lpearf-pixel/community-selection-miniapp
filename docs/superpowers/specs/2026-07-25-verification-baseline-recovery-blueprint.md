# Verification Baseline Recovery — System Engineering Blueprint

## 1. Mission and non-goals

Restore a trustworthy green base for `stable/l50-a3-4-business-base` without repeatedly rerunning a fail-fast chain that reveals one historical failure at a time.

Success means one audit run records every verifier outcome, each failure has isolated evidence, and feature PRs are tested only after the base is green. This work does not weaken production validation, change business behavior to satisfy tests, or automatically label a verifier failure as a production defect.

## 2. Stakeholders and system boundary

| Actor/system | Responsibility | Input | Output |
|---|---|---|---|
| Maintainer | approves semantic classification and repair scope | audit evidence | reviewed decisions |
| GitHub Actions | schedules reproducible collection | commit SHA | run/job evidence |
| Self-hosted Runner | executes the repository checks | manifest and environment | per-check exit code and log |
| Verification audit | observes every check without fail-fast truncation | ordered checks | JSON/Markdown summary |
| `verify:all` | remains the release gate | repository state | fail-fast release verdict |
| L10–L49 verifiers | express historical contracts | code/database | contract evidence |

Controlled: audit manifest, logging, report format, branch policy. Directly observed: command, exit code, duration, log. Inferred: production regression versus test drift. Unknown until review: downstream failures caused by prior shared-state mutation.

## 3. Context and feedback loop

Repository state → execute all checks → capture isolated evidence → classify failures → batch repairs by class → rerun audit → validate fail-fast gate → update base policy.

The audit is diagnostic and report-only in its dedicated workflow. The existing release gate remains fail-closed.

## 4. Subsystems and interface contracts

| Subsystem | Input contract | Output contract | Failure behavior |
|---|---|---|---|
| Manifest | ordered check records with stable IDs | complete L10–L49 command list | duplicate IDs rejected |
| Runner | manifest, cwd, output directory | summary object plus one log per check | continues after command failure; crashes only on collector faults |
| Reporter | observations from runner | `summary.json` and `summary.md` | atomic final summary after all checks |
| Triage | failed observations | reviewed category and repair batch | no automatic production/test judgment |
| Release gate | repaired base | normal `pnpm verify:all` result | any failure blocks merge |

## 5. Observation–hypothesis–decision model

Observations store check ID, command, layer, start/end time, exit code, signal and log path. Classification starts as `untriaged`. Hypotheses record whether evidence indicates production regression, test drift, environment failure or cascade. Decisions identify the repair batch, reviewer and rollback commit.

## 6. Minimum closed-loop pilot

Run the collector once on the current base through the self-hosted Runner. Entry condition: targeted collector contract passes. Immediate validation: all registered checks have a terminal record even when earlier checks fail. Exit condition: a complete summary artifact exists and contains the known L22 and migration-scan failures without stopping at either.

## 7. Metrics and validation

- audit coverage: recorded checks / manifest checks = 100%;
- truncation: zero missing terminal records;
- evidence isolation: one log per check;
- diagnosis cost: one Runner execution per base snapshot;
- base health: zero failed checks before feature PR synchronization;
- recurrence: no rediscovery of already-classified base failures.

## 8. Human review and escalation

Production code changes, weakened compliance rules, database migration changes, and ambiguous shared-state failures require maintainer review. Collector/report changes are reversible by reverting the infrastructure PR. A check failure never becomes a production diagnosis solely from its name or exit code.

## 9. Risks, unknowns, and reversible decisions

| Risk | Evidence today | Test | Reversible response |
|---|---|---|---|
| shared database creates cascades | historical verifiers mutate one database | inspect ordering and logs after first failed stateful check | rerun only the affected batch on isolated DB |
| audit hides failure | report-only workflow intentionally exits zero | targeted test verifies default mode exits nonzero | keep release gate fail-fast and separate |
| duplicated registry drifts | L24–L47 already have a registry | build audit checks from the registry | reject duplicate check IDs |
| logs become too large | full repository checks are verbose | store full logs as artifact, summary only in job output | cap console excerpts, retain files |

## 10. Stage gates

| Stage | Entry | Exit | Forbidden expansion |
|---|---|---|---|
| Observe | current base and RED collector test | complete audit artifact | business fixes |
| Classify | complete observations | every failure reviewed | guessing from first error |
| Recover | approved repair batches | audit and `verify:all` green | feature scope |
| Synchronize | green base | PR #105 final CI and browser gate | repeated reruns before blockers clear |

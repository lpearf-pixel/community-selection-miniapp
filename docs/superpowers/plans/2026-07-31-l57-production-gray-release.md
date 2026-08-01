# L57 Production Deployment and Gray Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the fixed stable SHA to Tencent Cloud Shanghai and produce validated evidence for backup recovery, real WeChat commerce, and a tightly bounded gray release.

**Architecture:** Keep the existing L52 single-server production topology. Add fail-closed host/release checks, an isolated restore-drill project, a redacted acceptance manifest, and one focused L57 gate; actual production secrets remain only on the host.

**Tech Stack:** Node.js 22/24, pnpm 9.15.4, Docker Compose v2, PostgreSQL 16, Bash, GnuPG, GitHub Actions.

## Global Constraints

- Target Tencent Cloud Shanghai `ap-shanghai`, Ubuntu 22.04/24.04, 4 CPU cores, 8 GiB memory, 100 GB disk, and 10 Mbps.
- Do not add business features, Redis, MQ, Kubernetes, microservices, or a second production API replica.
- Keep all production values in `.env.production` and read-only `secrets/`; never commit populated files or credentials.
- Keep `FIRST_LAUNCH_MODE=true` and membership, coupon, cash reward, and withdrawal capability switches false during initial gray release.
- GitHub Actions validates candidates but never performs an unversioned overwrite deployment.
- Restore drills must use an isolated Compose project and must never target the production PostgreSQL volume.
- Every behavior change follows RED → GREEN → refactor.

---

### Task 1: Fail-closed L57 host and release readiness

**Files:**
- Create: `scripts/production/l57-readiness.test.cjs`
- Create: `scripts/production/l57-readiness.mjs`
- Modify: `.env.production.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tencent region/instance ID/instance type, `IMAGE_TAG`, `API_DOMAIN`, `ADMIN_DOMAIN`, current Git HEAD, host facts, Tencent instance metadata, a read-only `DescribeInstances` response obtained through the CVM role, and DNS results.
- Produces: `checkL57Readiness({ env, host, cloudMetadata, resolve4, gitHead }): Promise<ReadinessResult>` and CLI `pnpm prod:l57:readiness`.

- [ ] **Step 1: Write tests that reject the wrong region, undersized host, SHA drift, and DNS mismatch**

  Tests inject deterministic host facts, Tencent metadata/API responses, and DNS answers. A valid fixture uses `ap-shanghai`, Ubuntu 22.04/24.04, matching instance ID/type/public IP, an API-reported running 4-core/8-GiB/100-GB/10-Mbps instance, at least 7680 MiB usable memory, matching 40-character SHA, and both domains resolving only to the metadata public IPv4.

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/production/l57-readiness.test.cjs`

  Expected: FAIL because `l57-readiness.mjs` does not exist.

- [ ] **Step 3: Implement the minimal readiness checker**

  Validate Ubuntu x64/arm64, minimum resources, exact region, clean SHA equality, Tencent metadata binding, a live read-only CVM API result including purchased public bandwidth, and exact DNS record-set equality. Error output lists field names but never values from secret-bearing keys.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/production/l57-readiness.test.cjs scripts/production/preflight.test.cjs`

  Expected: all readiness and existing preflight tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add .env.production.example package.json scripts/production/l57-readiness.mjs scripts/production/l57-readiness.test.cjs
  git commit -m "feat(l57): fail closed on production host readiness"
  ```

### Task 2: Isolated encrypted-backup restore drill

**Files:**
- Create: `scripts/production/restore-drill.test.cjs`
- Create: `scripts/production/restore-drill.sh`
- Modify: `package.json`
- Modify: `docs/ops/postgres-backup-restore.md`

**Interfaces:**
- Consumes: `BACKUP_FILE`, `RESTORE_DRILL_CONFIRM=RESTORE_IN_ISOLATED_DRILL`, `.env.production`, and an optional unique `RESTORE_DRILL_ID`.
- Produces: CLI `pnpm prod:restore:drill` and a summary containing the fixed release SHA, migration count, and non-sensitive core-table counts.

- [ ] **Step 1: Write shell-contract tests**

  Require exact confirmation, a project name prefixed `community-selection-restore-drill-`, only `postgres`, `restore`, and `migrate` services, a uniquely named database volume, and cleanup limited to that project with `down --volumes`.

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/production/restore-drill.test.cjs`

  Expected: FAIL because the drill script does not exist.

- [ ] **Step 3: Implement the isolated drill**

  Render and validate Compose, start only the isolated PostgreSQL service, restore the encrypted backup, run forward migrations, query migration and core-table counts, then clean only the drill project. Preserve the project on failure when `RESTORE_DRILL_KEEP_ON_FAILURE=true` for investigation.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/production/restore-drill.test.cjs scripts/production/backup-restore.test.cjs scripts/production/operations.test.cjs`

  Expected: all restore safety contracts pass.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json scripts/production/restore-drill.sh scripts/production/restore-drill.test.cjs docs/ops/postgres-backup-restore.md
  git commit -m "feat(l57): add isolated production restore drill"
  ```

### Task 3: Redacted production acceptance evidence

**Files:**
- Create: `deploy/l57/acceptance.example.json`
- Create: `scripts/production/l57-acceptance.test.cjs`
- Create: `scripts/production/l57-acceptance.mjs`
- Modify: `package.json`
- Modify: `docs/ops/purchase-group-production-acceptance.md`
- Modify: `docs/ops/gray-release-sop.md`

**Interfaces:**
- Consumes: a local ignored acceptance JSON file and current release SHA.
- Produces: `validateAcceptanceManifest(manifest, expectedSha)` and CLI `pnpm prod:l57:acceptance -- --file <path> --sha <sha>`.

- [ ] **Step 1: Write failing manifest tests**

  For `core_gray`, require P01–P04, G01–G05, R01, F01, A01–A02, O01–O02, B01–B02 and M00 (membership disabled). For the later `membership_gray`, require the same core set plus M01–M04 (membership purchase, legacy activation, gift claim, and refund fence). Reject full order IDs, openid, session tokens, private keys, certificates, callback bodies, missing timestamps, duplicate scenario IDs, failed scenarios, and a SHA different from the deployed candidate.

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/production/l57-acceptance.test.cjs`

  Expected: FAIL because the validator and template do not exist.

- [ ] **Step 3: Implement the minimal validator and template**

  Allow only operator alias, UTC timestamp, order suffix of four characters, result, scenario-bound screenshot paths, and redacted notes. Scan every operator-controlled evidence string for secrets, project order/payment identifiers, UUIDs, long tokens and payload shapes; ignore populated manifests and evidence directories. The CLI verifies each adjacent evidence file is a non-symlink regular PNG with valid chunks, CRCs and decodable pixel stream before printing a summary without evidence contents.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/production/l57-acceptance.test.cjs`

  Expected: all completeness, drift, and redaction tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add deploy/l57 package.json scripts/production/l57-acceptance.mjs scripts/production/l57-acceptance.test.cjs docs/ops/purchase-group-production-acceptance.md docs/ops/gray-release-sop.md
  git commit -m "feat(l57): validate redacted gray release evidence"
  ```

### Task 4: L57 release gate and operations checklist

**Files:**
- Create: `.github/workflows/l57-production-gray-release-gate.yml`
- Create: `scripts/production/l57-workflow-contract.test.cjs`
- Create: `docs/ops/l57-tencent-cloud-launch.md`
- Modify: `docs/production-checklist.md`

**Interfaces:**
- Consumes: L57 scripts, existing L52 production gate, fixed PR head.
- Produces: a local Community Runner L57 contract gate and an operator checklist for Tencent Cloud,备案, COS backup copy, Cloud Monitor, deployment, rollback, and gray release.

- [ ] **Step 1: Write a failing workflow contract**

  Require pull-request execution against the stable branch on `[self-hosted, community]`, reject `community-w01`, and keep frozen install, config build, all production tests, L57 tests, migration check, lint, typecheck, test, build, and no deployment or secret-bearing SSH step.

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/production/l57-workflow-contract.test.cjs`

  Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Add the focused gate and launch checklist**

  The checklist fixes region and machine size, requires only ports 80/443 plus restricted SSH, records COS encrypted-backup replication and Cloud Monitor alarms, and separates automated candidate verification from manual production mutation.

- [ ] **Step 4: Run GREEN and the repository gates**

  Run: `node --test scripts/production/*.test.cjs && pnpm migrations:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

  Expected: every local gate passes with no L50–L56 regression.

- [ ] **Step 5: Commit**

  ```bash
  git add .github/workflows/l57-production-gray-release-gate.yml scripts/production/l57-workflow-contract.test.cjs docs/ops/l57-tencent-cloud-launch.md docs/production-checklist.md
  git commit -m "ci(l57): gate production gray release package"
  ```

### Task 5: Publish candidate and execute the real environment gate

**Files:**
- Modify after execution: `docs/reviews/l57-production-gray-release.md`

**Interfaces:**
- Consumes: exact PR head, real production host, local secret files, two test WeChat accounts, and 0.01–0.10 yuan test products.
- Produces: Draft PR evidence, deployed `IMAGE_TAG`, encrypted backup name, isolated restore result, acceptance summary, and three-day gray-release ledger.

- [ ] **Step 1: Verify the branch locally**

  Run all commands from Task 4 plus `git diff --check` and a secret scan. Record exact commit and tree SHA.

- [ ] **Step 2: Push and open a Draft PR**

  Target `stable/l50-a3-4-business-base`; keep Draft until all affected public gates pass on the same head.

- [ ] **Step 3: Deploy the fixed candidate**

  On the Tencent Cloud host run `pnpm prod:l57:readiness`, `pnpm prod:preflight`, `pnpm prod:deploy`, `pnpm prod:backup`, and `pnpm prod:restore:drill` using local production files.

- [ ] **Step 4: Execute real WeChat and gray acceptance**

  Complete the acceptance manifest, validate it against the deployed SHA, then open only one community/WeChat group. Keep first-launch capability switches off.

- [ ] **Step 5: Final release decision**

  After three consecutive days without financial, refund, inventory, or open-alert differences, record the L57 review. If any stop condition occurs, preserve evidence and execute the documented application rollback without reversing migrations.

## Plan self-review

- Every L57 requirement maps to Tasks 1–5; remote credentials and real payments are explicitly execution inputs, not committed code.
- Restore cleanup is bounded by a unique project prefix and never names the production volume.
- No task adds remote features, dependencies, database schema, business rules, or automatic production deployment.
- No placeholders or ambiguous success criteria remain in the implementation steps.

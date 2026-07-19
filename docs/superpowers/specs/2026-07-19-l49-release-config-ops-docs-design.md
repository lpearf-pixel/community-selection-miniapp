# L49 Release Configuration and Operations Closure Design

## 1. Status and source

- Stage: L49 — MVP 发布配置 / 环境 / 运维文档收口
- Design date: 2026-07-19
- Business base branch: `stable/l48-business-base`
- Business base commit: `45b436c9b38635a34438ec50b81118666d162926`
- Implementation branch: `work/l49-release-config-ops-docs`
- Decision status: approved in conversation before this document was written

This design is governed by:

- `docs/plans/next-stage-development-plan.md`
- `docs/plans/global-development-requirements.md`
- `docs/plans/global-risk-register.md`

## 2. Goal

L49 delivers an executable, low-cost production deployment path for the existing MVP. It adds production API and Admin images, a production Docker Compose stack, an external-database override, a manually triggered multi-architecture GHCR image-publish workflow, operational runbooks, and deterministic L49 verification.

The result must support both `linux/amd64` and `linux/arm64` servers through one multi-platform image tag. CI builds and publishes images; an operator performs deployment and rollback on the server.

## 3. Non-goals

L49 does not:

- add or change business APIs;
- change the Prisma schema or add a migration;
- seed a production database;
- enable automatic payout or automatic tax filing;
- automatically enable real WeChat payment;
- automatically deploy through SSH;
- manage certificate issuance or renewal inside Compose;
- add Kubernetes, a service mesh, Redis, MQ, or microservices;
- modify `package.json`, `pnpm-lock.yaml`, TypeScript configuration, or dependency versions;
- fix the seven deferred L48 application/verifier risks inside the L49 production-delivery PR;
- commit `reports/`, a real `.env.production`, certificates, private keys, tokens, or credentials.

## 4. Confirmed deployment decisions

1. L49 supplies production-ready images and Compose, not documentation-only templates.
2. The default production stack includes PostgreSQL 16 on the same host.
3. An override supports an externally managed PostgreSQL database.
4. Nginx runs in Compose and mounts certificates already managed by the host.
5. GitHub Actions publishes images to GHCR.
6. CI builds images but never connects to or deploys to the production server.
7. Operators deploy and roll back manually with explicit image tags.
8. One tag is a manifest list containing `linux/amd64` and `linux/arm64`; Docker selects the host-compatible image automatically.
9. `latest` is forbidden for build publication and production deployment.

## 5. Repository deliverables

### 5.1 Production images and Compose

- `Dockerfile.api.production`
  - multi-stage build for shared/config packages, Prisma client, and API TypeScript output;
  - no source bind mount and no dependency installation at container start;
  - runtime command starts built JavaScript;
  - contains the pinned Prisma CLI needed only by the one-shot migration service;
  - API runtime uses a non-root user, a read-only root filesystem where compatible, and a writable `/tmp` tmpfs.
- `Dockerfile.admin.production`
  - multi-stage Admin build;
  - final image contains only static output and the minimal Nginx runtime configuration;
  - production Admin calls same-origin `/api`, so no production hostname or secret is baked into the image.
- `deploy/production/compose.yml`
  - default embedded-PostgreSQL production stack;
  - services: `postgres`, `migrate`, `api`, `admin`, `nginx`;
  - only edge Nginx publishes host ports 80 and 443;
  - API, Admin, and PostgreSQL remain on internal Compose networks.
- `deploy/production/compose.external-db.yml`
  - marks embedded `postgres` as inactive;
  - resets the `migrate` dependency on embedded PostgreSQL;
  - requires an explicit external `DATABASE_URL`;
  - requires Docker Compose with support for the documented `!reset` merge tag. The minimum supported Compose release will be tested and stated in the runbook; the implementation baseline is Compose 2.24.4 or newer.
- `deploy/production/env.production.example`
  - contains names, non-secret examples, format constraints, and comments only;
  - the operator copies it to the Git-ignored `.env.production` on the server.
- `deploy/production/nginx/default.conf.template`
  - host-managed TLS certificate paths are injected by the official Nginx template mechanism;
  - routes the API domain to API and the Admin domain to Admin;
  - routes `/api` on the Admin domain to API for same-origin Admin requests;
  - exposes `/healthz` without exposing upstream details;
  - access logs omit query strings, request/response headers, cookies, IP addresses, referrers, and user agents.
- `deploy/production/admin/default.conf`
  - serves Vite output with SPA fallback;
  - exposes a container-local health endpoint.

The existing root `docker-compose.yml` and `Dockerfile.dev` remain development-only and are not repurposed as production artifacts.

### 5.2 Image publication workflow

- `.github/workflows/l49-publish-production-images.yml`
  - pull requests build both production Dockerfiles without publishing;
  - `workflow_dispatch` accepts a source ref and explicit release tag;
  - manual publication validates the source ref resolves to one immutable commit;
  - the release tag must match the documented Docker tag grammar and must not be `latest`;
  - Buildx and QEMU build `linux/amd64,linux/arm64`;
  - API and Admin are published under separate GHCR package names with the same release tag;
  - every publication also creates `sha-<full-40-character-commit>` tags;
  - the workflow emits the resolved commit and manifest digests in its summary;
  - publication authenticates with `GITHUB_TOKEN`, `contents: read`, and `packages: write` only in the publish job;
  - third-party and GitHub actions are pinned to full commit SHAs rather than mutable tags;
  - no production database, SSH, TLS, Admin, or payment secret is accepted by the workflow.

GHCR package names are:

- `ghcr.io/lpearf-pixel/community-selection-api`
- `ghcr.io/lpearf-pixel/community-selection-admin`

### 5.3 Canonical documentation

- `docs/deployment/production-compose.md`
  - host prerequisites, GHCR login, certificate layout, environment creation, embedded/external database commands, first deployment, health checks, and smoke verification.
- `docs/operations/production-release.md`
  - normal upgrade procedure, immutable tag/digest recording, pre-deploy backup, migration gate, controlled start, smoke test, and gradual release.
- `docs/operations/certificate-renewal.md`
  - host-managed certificate renewal and Nginx configuration/reload verification; no automated certificate mutation in Compose.
- `docs/runbooks/production-rollback.md`
  - application rollback by previous explicit tag, decision boundary for database restoration, maintenance-mode requirements, and post-rollback verification.
- `docs/runbooks/postgres-backup-restore.md`
  - embedded and external database backup commands, checksum recording, retention, restore drill, and destructive restore warnings.
- `docs/reviews/l49-release-config-ops-docs.md`
  - stage scope, threat review, verification evidence checklist, deferred risks, and final reviewer decision.

Existing deployment documents that contain obsolete commands become short compatibility entry points to the canonical L49 documents. In particular, production instructions must not invoke `prisma migrate dev`, the root `pnpm db:migrate` development alias, production seed, or `docker compose down -v`.

## 6. Runtime architecture and ordering

### 6.1 Networks and exposure

- `edge` network: edge Nginx, Admin, API.
- `backend` internal network: API/migrate and embedded PostgreSQL.
- `postgres` publishes no host port.
- `api` publishes no host port.
- `admin` publishes no host port.
- `nginx` publishes only 80 and 443.

### 6.2 Start order

For embedded PostgreSQL:

1. `postgres` becomes healthy through `pg_isready`.
2. one-shot `migrate` runs `prisma migrate deploy` and exits zero;
3. `api` may start only after `migrate` completed successfully;
4. `admin` starts from immutable static content;
5. edge `nginx` starts and reports healthy only when its own configuration is valid.

For external PostgreSQL:

1. preflight validates the external `DATABASE_URL` is present without printing it;
2. one-shot `migrate` connects to the external database and runs `prisma migrate deploy`;
3. `api`, `admin`, and edge `nginx` follow the same start rules.

Neither mode runs seed. A failed migration blocks the new API release.

### 6.3 Health checks

- API container: `GET /api/health` must return a successful envelope.
- Admin container: local `/healthz` returns 200 without SPA content.
- edge Nginx: local `/healthz` returns 200 after `nginx -t` succeeds.
- production verification: HTTPS API health and Admin landing page are requested through the public routing layer.

Health checks do not include secrets or detailed dependency error messages.

## 7. Production configuration contract

### 7.1 Required non-secret release inputs

- `GHCR_OWNER=lpearf-pixel`
- `IMAGE_TAG=<explicit immutable or approved release tag>`
- `API_DOMAIN=<production API hostname>`
- `ADMIN_DOMAIN=<production Admin hostname>`
- `TLS_CERT_ROOT=<host directory containing certificates>`
- database mode: embedded by command choice, external by including the override file.

### 7.2 Required secret/runtime inputs

- database credentials or external `DATABASE_URL`;
- `ADMIN_TOKEN` with at least 24 characters;
- independent `ADMIN_TOTP_ENCRYPTION_KEY` with at least 32 characters;
- any WeChat payment values required only when an operator explicitly switches to real payment mode.

The server `.env.production` must have mode `0600`. Preflight reads values but prints only variable names and pass/fail outcomes.

### 7.3 Forced production boundaries

- `NODE_ENV=production`
- `ADMIN_AUTH_ENABLED=true`
- `ADMIN_AUTH_MODE=session`
- `AUTO_PAYOUT_ENABLED=false`
- `AUTO_TAX_FILING_ENABLED=false`
- initial/default `WECHAT_PAY_MODE=mock`
- initial/default `MOCK_WECHAT_PAY=true`
- no development Admin token;
- no local personal certificate/key path;
- no empty tag and no `latest` tag.

Switching to real WeChat payment remains a separate manual checklist action. L49 does not change payment behavior.

## 8. Manual deployment flow

1. Check out the deployment configuration at an approved commit.
2. Confirm Docker Engine/Compose versions and host architecture.
3. Create `.env.production` from the template and set mode `0600`.
4. Log in to GHCR using a read-only package credential on the server.
5. Pull the explicit API/Admin image tag.
6. Inspect multi-platform manifest metadata and record API/Admin manifest digests.
7. Run the secret-safe L49 preflight.
8. Run `docker compose config --quiet` for the selected database mode.
9. Create a pre-deploy PostgreSQL backup and checksum and record its location.
10. Run the one-shot migration service and require exit code zero.
11. Start API, Admin, and edge Nginx.
12. Wait for container health checks.
13. Verify HTTPS API health, Admin landing page, and the documented minimal smoke route.
14. Observe logs and business alerts before gradually opening traffic.

The runbook supplies exact commands for both database modes. Commands must not echo the rendered Compose model because it can contain resolved environment values.

## 9. Rollback and failure handling

### 9.1 Application rollback

- Keep the previous approved API/Admin tag and manifest digests in the release record.
- Set `IMAGE_TAG` to the previous tag.
- Pull, run `docker compose config --quiet`, start the prior images, and repeat health/smoke checks.
- Never fall back to `latest`.

### 9.2 Database rollback boundary

Prisma migrations are forward operations and are not automatically reversed. If the previous application is compatible with the migrated schema, roll back images only. If it is not compatible:

1. enter maintenance mode and stop business writes;
2. preserve current logs and a current database snapshot;
3. obtain explicit human approval for destructive recovery;
4. restore the rehearsed pre-deploy backup;
5. start the previous application tag;
6. run financial and order reconciliation checks before reopening traffic.

Automated L49 tests never perform destructive recovery against a user database.

### 9.3 Failure diagnostics

- migration failure: show service name, exit code, safe Prisma error code, and log-inspection command; do not start API;
- health timeout: show failing URL/service and `docker compose logs --tail=200 <service>` guidance;
- certificate/configuration failure: run `nginx -t`, retain the previous running stack, and do not reload;
- GHCR pull failure: preserve the previous running images and report package/tag/architecture without printing credentials;
- backup failure: abort deployment before migration.

## 10. L49 verification design

### 10.1 Stage contract and registry

- `scripts/l49-release-ops-contract.ts` defines L49 markers and allowed/report evidence.
- `scripts/stage-registry.ts` registers L49 after L48.
- L49 report contract binds to:
  - branch `stable/l48-business-base`;
  - commit `45b436c9b38635a34438ec50b81118666d162926`.
- `scripts/stage-workflow.ts` derives L24-L49 chain behavior from the registry and gives L49 additional verifiers descriptive names.
- L49 report routing and publish verification follow the existing registry/evidence-hook architecture; `reports/` remains excluded from the business PR.

### 10.2 Static L49 verifier

`scripts/verify-l49-release-config-ops-docs-local.ts` must verify semantic requirements, including:

- all production artifacts and canonical runbooks exist;
- production Dockerfiles contain build/runtime stages and production commands;
- runtime Compose contains no bind-mounted source, package installation, dev server, seed, or `migrate dev`;
- only edge Nginx publishes ports;
- embedded/external database modes have the required dependency difference;
- migration uses `prisma migrate deploy` and gates API start;
- explicit image tag checks reject empty and `latest` values;
- production auth and disabled automation settings fail closed;
- Nginx access log format omits query, header, cookie, IP, referrer, and user-agent data;
- GitHub Actions targets `linux/amd64,linux/arm64`, uses GHCR, pins actions to full SHAs, limits permissions, and has no remote-deploy/SSH step;
- canonical runbooks contain executable commands, pre-deploy backup, health, rollback, external DB, certificate renewal, and secret-handling sections;
- old production docs do not retain `pnpm db:migrate`, production seed, destructive volume deletion, or contradictory canonical instructions;
- forbidden scope files and secret-like content are absent.

Static source checks do not substitute for the runtime production smoke test.

### 10.3 Compose validation

The verifier executes secret-safe configuration checks for:

- embedded PostgreSQL mode;
- external PostgreSQL override mode.

Both use `docker compose config --quiet`. Test-only dummy values live in the verifier process environment and are never written to a tracked file or printed.

### 10.4 Production Docker smoke test

`scripts/run-l49-production-docker-smoke-local.ts` creates a unique Compose project and temporary directory, then:

1. generates short-lived self-signed test certificates outside the repository;
2. builds API/Admin production images for the local architecture;
3. starts an isolated embedded-PostgreSQL stack with uniquely named volumes;
4. proves migration exits zero before API health succeeds;
5. proves API/Admin/edge Nginx health;
6. calls HTTPS API health and the Admin page through edge Nginx;
7. restarts API/Admin/Nginx without rebuilding and proves health again;
8. proves PostgreSQL data survives application-container restart;
9. validates external-database Compose resolution and its lack of an active embedded PostgreSQL service;
10. collects safe logs on failure;
11. removes only its unique containers, networks, volumes, and temporary certificates in `finally`.

The smoke test never uses, stops, or deletes the normal development Compose project or its `postgres-data` volume.

### 10.5 Required stage evidence

L49 completion requires:

- L49 static verifier passed;
- L49 production Docker smoke passed;
- raw compliance scan passed;
- Docker API E2E passed;
- Admin strict typecheck passed;
- L24-L49 chain regression passed;
- stage workflow passed;
- L49 report generation, report verification, and report publication evidence are bound to the reviewed source commit;
- PR diff contains no dependency/lockfile/Prisma schema/migration/report/secret changes.

## 11. Deferred L48 risk linkage

L49 reads `docs/plans/global-risk-register.md` before implementation. It does not hide or relabel the seven accepted risks.

The L49 documentation update assigns:

- `GR-SEC-001`, `GR-PRIV-002`, `GR-OBS-004`: API security/privacy owner role;
- `GR-FIN-003`: finance/API correctness owner role;
- `GR-TEST-005`, `GR-TEST-006`, `GR-TEST-007`: verifier/database-test owner role.

All four Important items target independent hardening PR work after L49 and before L50 Release Candidate acceptance. Each entry must record its target branch/PR when opened and its rollback approach. L49 reports may say that no new automated L49 risk was found, but they must not claim the product has zero residual risk.

## 12. Security review

- Production secrets exist only in server-controlled files/credential stores.
- GHCR publishing uses repository-scoped `GITHUB_TOKEN`; the server uses read-only package credentials.
- Actions are pinned to immutable commits.
- Images are selected by explicit tags and release records retain manifest digests.
- Edge logs exclude identity/network/header/query data rather than relying on application sanitization.
- Database and internal services are not bound to public host ports.
- Nginx certificate directories are read-only mounts.
- API runs as non-root; containers use `no-new-privileges`, capability drops, read-only filesystems, and tmpfs where compatible.
- Production startup never installs dependencies or runs seed.
- Migration failure, backup failure, or health failure stops deployment.

## 13. Compatibility and operator requirements

- Production host: Linux with Docker Engine, Docker Compose 2.24.4 or newer, sufficient disk for two image releases and retained backups.
- Supported CPU architectures: `linux/amd64`, `linux/arm64`.
- TLS: certificates already issued and renewed by the host; Compose only mounts and reloads them.
- Default operating mode remains the current MVP boundary: mock payment, manual withdrawal handling, manual tax review, no automatic payout, no automatic tax filing.

## 14. References

- Docker Compose merge/reset behavior: https://docs.docker.com/reference/compose-file/merge/
- Docker multi-platform images: https://docs.docker.com/build/building/multi-platform/
- Docker multi-platform GitHub Actions: https://docs.docker.com/build/ci/github-actions/multi-platform/
- GitHub Packages publication permissions: https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions

## 15. Acceptance statement

The design is accepted only when implementation preserves every non-goal, both database modes validate, the isolated production smoke passes without touching development data, multi-platform GHCR publication is reproducible from one commit, and all L49/stage/report gates pass at the final reviewed head.

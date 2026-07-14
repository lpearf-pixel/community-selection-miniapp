import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content);
  console.log(`updated ${path}`);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`missing replacement target: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`replacement target is not unique: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceRegex(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`expected one regex target for ${label}, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

const withdrawalsPath = 'apps/api/src/routes/withdrawals.ts';
let withdrawals = read(withdrawalsPath);

const scopeHelperAnchor = `function linksInScope(links: WithdrawalLinkWithOrder[], context: ReturnType<typeof resolveAdminAccessContext>) {
  if (!context) return false;
  if (context.is_super_admin) return true;
  return links.length > 0 && links.every((link) => canAccessOrderDataScope(context, link.commission.order));
}
`;

const scopeHelpers = `${scopeHelperAnchor}
function adminOrderScopeWhere(
  context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>,
): Prisma.OrderWhereInput | null {
  if (
    context.is_super_admin ||
    context.data_scope.can_access_all_pickup_stores ||
    context.data_scope.can_access_all_communities
  ) {
    return {};
  }

  const conditions: Prisma.OrderWhereInput[] = [];
  if (context.data_scope.pickup_store_ids.length > 0) {
    conditions.push({
      pickup_store_id: { in: context.data_scope.pickup_store_ids },
    });
  }
  if (context.data_scope.community_ids.length > 0) {
    conditions.push({
      community_id: { in: context.data_scope.community_ids },
    });
  }

  return conditions.length > 0 ? { OR: conditions } : null;
}

function withdrawalScopeWhere(
  context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>,
): Prisma.WithdrawalWhereInput {
  if (context.is_super_admin) return {};
  const orderScope = adminOrderScopeWhere(context);
  if (!orderScope) return { id: { in: [] } };

  return {
    commission_links: {
      some: {},
      every: {
        commission: {
          order: orderScope,
        },
      },
    },
  };
}
`;

if (!withdrawals.includes('function withdrawalScopeWhere(')) {
  withdrawals = replaceOnce(withdrawals, scopeHelperAnchor, scopeHelpers, 'withdrawal scope helpers');
}

const adminListReplacement = `  app.get(
    "/api/admin/withdrawals",
    { preHandler: requireAdminPermission("withdrawal.view") },
    async (request, reply) => {
      try {
        const query = request.query as AdminWithdrawalQuery;
        const page = Math.max(1, Number(query.page ?? 1) || 1);
        const pageSize = Math.min(
          100,
          Math.max(1, Number(query.page_size ?? 20) || 20),
        );
        const context = resolveAdminAccessContext(request)!;
        const keyword = String(query.keyword ?? "").trim();
        const baseWhere: Prisma.WithdrawalWhereInput = {
          ...(query.status ? { status: query.status as any } : {}),
          ...(query.leader_user_id
            ? { leader_user_id: query.leader_user_id }
            : {}),
          ...(query.client_request_id
            ? { client_request_id: query.client_request_id }
            : {}),
          ...parseDateRange(query),
        };
        const keywordWhere: Prisma.WithdrawalWhereInput | null = keyword
          ? {
              OR: [
                {
                  leader_user_id: {
                    contains: keyword,
                    mode: "insensitive",
                  },
                },
                {
                  client_request_id: {
                    contains: keyword,
                    mode: "insensitive",
                  },
                },
                {
                  leader_user: {
                    is: {
                      nickname: {
                        contains: keyword,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              ],
            }
          : null;
        const where: Prisma.WithdrawalWhereInput = {
          AND: [
            baseWhere,
            withdrawalScopeWhere(context),
            ...(keywordWhere ? [keywordWhere] : []),
          ],
        };
        const [total, rows] = await prisma.$transaction([
          prisma.withdrawal.count({ where }),
          prisma.withdrawal.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              leader_user: true,
              commission_links: {
                include: {
                  commission: {
                    include: {
                      order: {
                        include: { product: true, community: true },
                      },
                    },
                  },
                },
              },
            },
            orderBy: [{ created_at: "desc" }, { id: "asc" }],
          }),
        ]);
        return ok({
          items: rows.map((withdrawal) =>
            adminWithdrawalDto(
              withdrawal,
              withdrawal.commission_links as unknown as WithdrawalLinkWithOrder[],
            ),
          ),
          total,
          page,
          page_size: pageSize,
        });
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "查询提现申请失败");
      }
    },
  );

`;

withdrawals = replaceRegex(
  withdrawals,
  /  app\.get\(\n    "\/api\/admin\/withdrawals",[\s\S]*?\n  \);\n\n(?=  app\.get\(\n    "\/api\/admin\/withdrawals\/:id")/,
  adminListReplacement,
  'admin withdrawal list route',
);

const taxRecordsReplacement = `  app.get(
    "/api/admin/tax-records",
    { preHandler: requireAdminPermission("finance.view") },
    async (request, reply) => {
      try {
        const query = request.query as TaxRecordQuery;
        const context = resolveAdminAccessContext(request)!;
        const baseWhere: Prisma.TaxRecordWhereInput = {
          ...(query.leader_user_id
            ? { leader_user_id: query.leader_user_id }
            : {}),
          ...(query.source_type ? { source_type: query.source_type } : {}),
          ...(query.source_id ? { source_id: query.source_id } : {}),
          ...(query.tax_status ? { tax_status: query.tax_status } : {}),
          ...parseDateRange(query),
        };
        const scopeFilters: Prisma.TaxRecordWhereInput[] = [];
        if (!context.is_super_admin) {
          const accessibleWithdrawalIds = (
            await prisma.withdrawal.findMany({
              where: withdrawalScopeWhere(context),
              select: { id: true },
            })
          ).map((withdrawal) => withdrawal.id);
          scopeFilters.push({
            OR: [
              { source_type: { not: "withdrawal" } },
              {
                source_type: "withdrawal",
                source_id: { in: accessibleWithdrawalIds },
              },
            ],
          });
        }
        const records = await prisma.taxRecord.findMany({
          where: {
            AND: [baseWhere, ...scopeFilters],
          },
          orderBy: { created_at: "desc" },
          take: 200,
        });
        return ok(records);
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "查询税务记录失败");
      }
    },
  );

`;

withdrawals = replaceRegex(
  withdrawals,
  /  app\.get\(\n    "\/api\/admin\/tax-records",[\s\S]*?\n  \);\n\n(?=  app\.post\(\n    "\/api\/admin\/withdrawals\/:id\/reject")/,
  taxRecordsReplacement,
  'admin tax records route',
);

write(withdrawalsPath, withdrawals);

const stagePath = 'scripts/stage-workflow.ts';
let stage = read(stagePath);
if (!stage.includes('readFileSync')) {
  stage = replaceOnce(
    stage,
    "import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    'stage workflow readFileSync import',
  );
}
if (!stage.includes('function runReportVerifier()')) {
  stage = replaceOnce(
    stage,
    `function runReportStage(stage: string): void {
  runCommand({ title: \`report:stage \${stage}\`, command: 'pnpm', args: ['report:stage', '--', \`--stage=\${stage}\`] });
}
`,
    `function runReportStage(stage: string): void {
  runCommand({ title: \`report:stage \${stage}\`, command: 'pnpm', args: ['report:stage', '--', \`--stage=\${stage}\`] });
}

function runReportVerifier(): void {
  runCommand({ title: 'report publish verifier', command: 'pnpm', args: ['exec', 'tsx', 'scripts/verify-report-publish-local.ts'] });
  const latestOutput = readFileSync(latestVerifyOutput, 'utf8');
  if (!latestOutput.includes('Report publish verification passed.')) {
    throw new Error('Report publish verifier did not emit required success marker: Report publish verification passed.');
  }
}
`,
    'stage workflow report verifier function',
  );
}
if (!stage.includes('runReportStage(args.stage!);\n    runReportVerifier();')) {
  stage = replaceOnce(
    stage,
    `    runReportStage(args.stage!);
    runReportPublish(args);`,
    `    runReportStage(args.stage!);
    runReportVerifier();
    runReportPublish(args);`,
    'stage workflow report verifier order',
  );
}
write(stagePath, stage);

const reportVerifierPath = 'scripts/verify-report-publish-local.ts';
let reportVerifier = read(reportVerifierPath);
if (!reportVerifier.includes('stage workflow must run report verifier before report publish')) {
  reportVerifier = replaceOnce(
    reportVerifier,
    "console.log('Report publish verification passed.');",
    `const stageWorkflowSource = read('scripts/stage-workflow.ts');
const reportStageIndex = stageWorkflowSource.indexOf('runReportStage(args.stage!)');
const reportVerifierIndex = stageWorkflowSource.indexOf('runReportVerifier()');
const reportPublishIndex = stageWorkflowSource.indexOf('runReportPublish(args)');
assert(reportStageIndex >= 0, 'stage workflow must run report:stage in publish flow');
assert(reportVerifierIndex > reportStageIndex, 'stage workflow must run report verifier after report:stage');
assert(reportPublishIndex > reportVerifierIndex, 'stage workflow must run report verifier before report publish');
assert(stageWorkflowSource.includes("args: ['exec', 'tsx', 'scripts/verify-report-publish-local.ts']"), 'stage workflow must invoke report verifier through pnpm exec tsx');
assert(stageWorkflowSource.includes('Report publish verification passed.'), 'stage workflow must require report verifier success marker');

console.log('Report publish verification passed.');`,
    'report verifier workflow assertions',
  );
}
write(reportVerifierPath, reportVerifier);

const l44VerifierPath = 'scripts/verify-l44-manual-withdrawal-review-local.ts';
let l44Verifier = read(l44VerifierPath);
l44Verifier = replaceOnce(
  l44Verifier,
  `assert(adminWithdrawalListRoute.includes('commission_links'), 'Admin withdrawal list must load persistent commission links');
assert(adminWithdrawalListRoute.includes('linksInScope'), 'Admin withdrawal list must apply data scope');
assert(adminWithdrawalListRoute.includes('total'), 'Admin withdrawal list must return filtered total');`,
  `assert(adminWithdrawalListRoute.includes('commission_links'), 'Admin withdrawal list must load persistent commission links');
assert(adminWithdrawalListRoute.includes('withdrawalScopeWhere(context)'), 'Admin withdrawal list must apply database data scope');
assert(adminWithdrawalListRoute.includes('prisma.$transaction(['), 'Admin withdrawal list count and page must share one transaction');
assert(adminWithdrawalListRoute.includes('prisma.withdrawal.count({ where })'), 'Admin withdrawal list must count in database');
assert(adminWithdrawalListRoute.includes('skip: (page - 1) * pageSize'), 'Admin withdrawal list must paginate with database skip');
assert(adminWithdrawalListRoute.includes('take: pageSize'), 'Admin withdrawal list must paginate with database take');
assert(!adminWithdrawalListRoute.includes('const candidates ='), 'Admin withdrawal list must not load all candidates');
assert(!adminWithdrawalListRoute.includes('scopedIds.slice'), 'Admin withdrawal list must not paginate in memory');
assert(adminWithdrawalListRoute.includes('total'), 'Admin withdrawal list must return scoped total');`,
  'L44 admin list verifier assertions',
);
if (!l44Verifier.includes("const taxRecordsRoute = routeBlock(route, 'get', '/api/admin/tax-records');")) {
  l44Verifier = replaceOnce(
    l44Verifier,
    `assert(route.includes('requireAdminPermission("finance.view")'), 'tax records keep finance.view semantics');`,
    `assert(route.includes('requireAdminPermission("finance.view")'), 'tax records keep finance.view semantics');
const taxRecordsRoute = routeBlock(route, 'get', '/api/admin/tax-records');
assert(taxRecordsRoute.includes('accessibleWithdrawalIds'), 'tax records must resolve accessible withdrawal ids before limiting results');
assert(taxRecordsRoute.includes('withdrawalScopeWhere(context)'), 'tax records must apply withdrawal data scope in database');
assert(taxRecordsRoute.includes('source_id: { in: accessibleWithdrawalIds }'), 'tax records must constrain withdrawal source ids before take');
assert(!taxRecordsRoute.includes('for (const record of records)'), 'tax records must not filter data scope after take');`,
    'L44 tax record verifier assertions',
  );
}
write(l44VerifierPath, l44Verifier);

for (const temporaryPath of [
  'scripts/l44-finalize-once.mjs',
  '.github/workflows/l44-finalize-once.yml',
]) {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
}

console.log('L44 one-time finalization patch completed.');

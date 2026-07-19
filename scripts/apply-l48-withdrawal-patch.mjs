import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apps/api/src/routes/withdrawals.ts';
let source = readFileSync(file, 'utf8');

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceOnce(label, needle, replacement) {
  const occurrences = count(source, needle);
  if (occurrences !== 1) {
    throw new Error(`${label}: expected exactly one occurrence, found ${occurrences}`);
  }
  source = source.replace(needle, replacement);
}

const adminMarker = '  app.get(\n    "/api/admin/withdrawals",';
const originalAdminIndex = source.indexOf(adminMarker);
if (originalAdminIndex < 0) throw new Error('Admin route marker not found');
const originalAdminSuffix = source.slice(originalAdminIndex);
const originalAdminHash = createHash('sha256').update(originalAdminSuffix).digest('hex');

replaceOnce(
  'current-user imports',
  'import { fail, ok } from "@community-selection/shared";\n',
  'import { fail, ok } from "@community-selection/shared";\n' +
    'import { publicCurrentUserError } from "../modules/current-user/current-user-security.js";\n' +
    'import { withCurrentLeader } from "./current-user-route.js";\n',
);

replaceOnce(
  'withdraw body identity fields',
  'type WithdrawBody = {\n  leader_user_id?: string;\n  openid?: string;\n  amount_cents?: number;\n',
  'type WithdrawBody = {\n  amount_cents?: number;\n',
);

replaceOnce(
  'legacy leader resolver',
  'async function resolveCurrentLeader(request: {\n  headers: Record<string, unknown>;\n}) {\n  const openid =\n    typeof request.headers["x-openid"] === "string"\n      ? request.headers["x-openid"].trim()\n      : "";\n  if (!openid)\n    throw Object.assign(new Error("LEADER_UNAUTHORIZED: 缺少身份"), {\n      statusCode: 401,\n    });\n  const user = await prisma.user.findUnique({ where: { openid } });\n  if (!user)\n    throw Object.assign(new Error("LEADER_UNAUTHORIZED: 用户不存在"), {\n      statusCode: 401,\n    });\n  if (user.role !== "leader")\n    throw Object.assign(new Error("LEADER_FORBIDDEN: 仅开团人可操作"), {\n      statusCode: 403,\n    });\n  return user;\n}\n\n',
  '',
);

replaceOnce(
  'leader withdrawal dto declaration',
  'function leaderWithdrawalDto(w: any, commissionCount = 0) {',
  'export function toLeaderWithdrawalDto(w: any, commissionCount = 0) {',
);

replaceOnce(
  'leader rejection message',
  'rejection_reason: w.status === "rejected" ? w.admin_remark : undefined,',
  'rejection_reason: w.status === "rejected" ? "提现申请未通过，请联系平台" : undefined,',
);

replaceOnce(
  'idempotent ownership conflict',
  'if (existing.leader_user_id !== leaderUserId) throw httpError("client_request_id 已被使用", 409);',
  'if (existing.leader_user_id !== leaderUserId) throw publicCurrentUserError("client_request_id 已被使用", 409);',
);

replaceOnce(
  'idempotent dto',
  'return { ...leaderWithdrawalDto(existing, count), applied: false, idempotent: true };',
  'return { ...toLeaderWithdrawalDto(existing, count), applied: false, idempotent: true };',
);

replaceOnce(
  'leader amount validation',
  'if (!Number.isInteger(amount) || amount <= 0)\n    throw new Error("提现金额必须大于 0");',
  'if (!Number.isInteger(amount) || amount <= 0)\n    throw publicCurrentUserError("提现金额必须大于 0", 400);',
);

const leaderStart = '  app.get("/api/leaders/me/withdrawals", async (request, reply) => {';
const leaderStartIndex = source.indexOf(leaderStart);
const adminStartIndex = source.indexOf(adminMarker);
if (leaderStartIndex < 0 || adminStartIndex < 0 || leaderStartIndex >= adminStartIndex) {
  throw new Error('Unable to isolate leader withdrawal route segment');
}

const oldLeaderSegment = source.slice(leaderStartIndex, adminStartIndex);
const routeLiteralCount = (oldLeaderSegment.match(/\/api\/leaders\/me\//g) ?? []).length;
if (routeLiteralCount !== 4) {
  throw new Error(`Expected four leader route literals, found ${routeLiteralCount}`);
}

const newLeaderSegment = `  app.get("/api/leaders/me/withdrawals", (request, reply) =>
    withCurrentLeader(request, reply, "查询提现申请失败", async (leader) => {
      const withdrawals = await prisma.withdrawal.findMany({
        where: { leader_user_id: leader.id },
        orderBy: { created_at: "desc" },
      });
      const counts = await prisma.withdrawalCommission.groupBy({
        by: ["withdrawal_id"],
        where: { withdrawal_id: { in: withdrawals.map((w) => w.id) } },
        _count: { _all: true },
      });
      const countMap = new Map(counts.map((c) => [c.withdrawal_id, c._count._all]));
      return withdrawals.map((w) =>
        toLeaderWithdrawalDto(w, countMap.get(w.id) ?? 0),
      );
    }),
  );

  app.get("/api/leaders/me/withdrawals/:id", (request, reply) =>
    withCurrentLeader(request, reply, "查询提现申请失败", async (leader) => {
      const { id } = request.params as { id: string };
      const withdrawal = await prisma.withdrawal.findFirst({
        where: { id, leader_user_id: leader.id },
      });
      if (!withdrawal) {
        throw publicCurrentUserError("提现申请不存在", 404);
      }
      const count = await prisma.withdrawalCommission.count({
        where: { withdrawal_id: id },
      });
      return toLeaderWithdrawalDto(withdrawal, count);
    }),
  );

  app.get(
    "/api/leaders/me/withdrawable-commissions",
    (request, reply) =>
      withCurrentLeader(
        request,
        reply,
        "查询可提现开团服务奖励失败",
        async (leader) => {
          const commissions = await prisma.commission.findMany({
            where: {
              leader_user_id: leader.id,
              status: "available",
              withdrawal_id: null,
              final_amount_cents: { gt: 0 },
            },
            include: { order: { include: { product: true, community: true } } },
            orderBy: { created_at: "asc" },
          });
          const balance = await getAvailableRewardBalance(prisma, leader.id);
          return {
            available_balance_cents: balance,
            commission_count: commissions.length,
            items: commissions.map((commission) => ({
              commission_id: commission.id,
              order_no: commission.order.order_no,
              product_name: commission.order.product?.name ?? "",
              final_amount_cents: commission.final_amount_cents,
              available_at: commission.available_at,
              community_name: commission.order.community?.name ?? "",
            })),
          };
        },
      ),
  );

  app.post("/api/leaders/me/withdrawals", (request, reply) =>
    withCurrentLeader(request, reply, "提交提现申请失败", async (leader) => {
      const body = request.body as WithdrawBody;
      const clientRequestId = String(body.client_request_id ?? "").trim();
      if (!clientRequestId || clientRequestId.length > 80) {
        throw publicCurrentUserError(
          "client_request_id 必填且长度不能超过 80",
          400,
        );
      }
      const quick = await idempotentWithdrawalByClientRequest(
        clientRequestId,
        leader.id,
      );
      if (quick) return quick;

      const ids = Array.from(
        new Set((body.commission_ids ?? []).map(String).filter(Boolean)),
      );
      if (ids.length === 0) {
        throw publicCurrentUserError("commission_ids 至少选择一条", 400);
      }

      try {
        const result = await prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const selected = await tx.commission.findMany({
              where: {
                id: { in: ids },
                leader_user_id: leader.id,
                status: "available",
                withdrawal_id: null,
                final_amount_cents: { gt: 0 },
              },
              orderBy: { created_at: "asc" },
            });
            if (selected.length !== ids.length) {
              throw publicCurrentUserError(
                "存在不可提现或已占用的开团服务奖励",
                409,
              );
            }
            const amount = selected.reduce(
              (sum, item) => sum + item.final_amount_cents,
              0,
            );
            if (
              body.amount_cents !== undefined &&
              parseAmount(body.amount_cents) !== amount
            ) {
              throw publicCurrentUserError(
                "提现金额必须精确匹配整笔开团服务奖励合计",
                400,
              );
            }

            const mismatches: Array<{
              commission_id: string;
              expected_cents: number;
              ledger_net_cents: number;
            }> = [];
            for (const item of selected) {
              const net = await getCommissionAvailableNet(tx, item.id);
              if (net !== item.final_amount_cents) {
                mismatches.push({
                  commission_id: item.id,
                  expected_cents: item.final_amount_cents,
                  ledger_net_cents: net,
                });
              }
            }
            if (mismatches.length > 0) {
              throw httpError(
                \`LEDGER_MISMATCH:\${JSON.stringify({
                  mismatches,
                  requested_amount_cents: amount,
                })}\`,
                409,
              );
            }

            const availableBalance = await getAvailableRewardBalance(
              tx,
              leader.id,
            );
            if (availableBalance < amount) {
              throw httpError(
                \`LEDGER_MISMATCH:\${JSON.stringify({
                  available_balance_cents: availableBalance,
                  requested_amount_cents: amount,
                })}\`,
                409,
              );
            }

            const created = await tx.withdrawal.create({
              data: {
                leader_user_id: leader.id,
                client_request_id: clientRequestId,
                amount_cents: amount,
                status: "pending",
                taxable_amount_cents: amount,
                tax_amount_cents: 0,
                payable_amount_cents: amount,
                tax_mode: "pending_review",
                tax_status: "pending",
                invoice_required: false,
                invoice_status: "not_required",
              },
            });
            const claimed = await tx.commission.updateMany({
              where: {
                id: { in: ids },
                status: "available",
                withdrawal_id: null,
              },
              data: { status: "withdrawing", withdrawal_id: created.id },
            });
            if (claimed.count !== ids.length) {
              throw publicCurrentUserError(
                "开团服务奖励已被其他提现申请占用",
                409,
              );
            }
            await tx.withdrawalCommission.createMany({
              data: selected.map((item) => ({
                withdrawal_id: created.id,
                commission_id: item.id,
                amount_cents: item.final_amount_cents,
              })),
              skipDuplicates: true,
            });
            await appendRewardLedgerEntry(tx, {
              leader_user_id: leader.id,
              withdrawal_id: created.id,
              event_type: "withdrawal_reserved",
              entry_type: "withdrawal_reserved",
              direction: "out",
              amount_cents: amount,
              affects_available_balance: true,
              idempotency_key: \`withdrawal-reserved:\${created.id}\`,
            });
            await logWithdrawalEvent(tx, {
              event_type: "withdrawal_requested",
              withdrawal: created,
              commissionIds: ids,
              orderIds: selected.map((item) => item.order_id),
              after: created,
            });
            return created;
          },
        );
        return {
          ...toLeaderWithdrawalDto(result, ids.length),
          applied: true,
          idempotent: false,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing = await idempotentWithdrawalByClientRequest(
            clientRequestId,
            leader.id,
          );
          if (existing) return existing;
        }
        if (
          error instanceof Error &&
          error.message.startsWith("LEDGER_MISMATCH:")
        ) {
          const payload = JSON.parse(
            error.message.slice("LEDGER_MISMATCH:".length),
          );
          await persistLedgerMismatch(leader.id, payload);
          throw publicCurrentUserError("奖励账本待人工复核", 409);
        }
        throw error;
      }
    }),
  );

`;

source = source.slice(0, leaderStartIndex) + newLeaderSegment + source.slice(adminStartIndex);

const nextAdminIndex = source.indexOf(adminMarker);
if (nextAdminIndex < 0) throw new Error('Admin route marker disappeared');
const nextAdminSuffix = source.slice(nextAdminIndex);
const nextAdminHash = createHash('sha256').update(nextAdminSuffix).digest('hex');
if (nextAdminHash !== originalAdminHash || nextAdminSuffix !== originalAdminSuffix) {
  throw new Error('Admin route suffix changed during leader-route patch');
}

for (const forbidden of [
  'resolveCurrentLeader(request)',
  'leaderWithdrawalDto(',
  'leader_user_id?: string;\n  openid?: string;',
]) {
  if (source.includes(forbidden)) {
    throw new Error(`Forbidden legacy fragment remains: ${forbidden}`);
  }
}

for (const required of [
  'withCurrentLeader(request, reply, "查询提现申请失败"',
  'withCurrentLeader(request, reply, "提交提现申请失败"',
  'export function toLeaderWithdrawalDto',
  '提现申请未通过，请联系平台',
]) {
  if (!source.includes(required)) {
    throw new Error(`Required fragment missing: ${required}`);
  }
}

writeFileSync(file, source);
console.log(`L48 withdrawal patch applied; admin_suffix_sha256=${originalAdminHash}`);

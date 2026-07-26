import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { contractFail, contractOk, fail, ok } from "@community-selection/shared";
import { publicCurrentUserError } from "../modules/current-user/current-user-security.js";
import { withCurrentLeader } from "./current-user-route.js";
import { prisma } from "../db.js";
import { countScopedTaxRecords, listScopedTaxRecordIds, restoreSelectedIdOrder } from "../modules/tax-record/tax-record-scope-repository.js";
import {
  getAvailableRewardBalance,
} from "../services/commission-service.js";
import {
  ADMIN_SCOPE_FORBIDDEN,
  canAccessOrderDataScope,
  requireAdminPermission,
  resolveAdminAccessContext,
} from "../modules/admin-access/admin-access-control.js";
import {
  parseAdminWithdrawalCommand,
  type AdminWithdrawalAction,
} from "../modules/withdrawal/admin-withdrawal-command.js";
import {
  AdminWithdrawalCommandError,
  executeAdminWithdrawalCommand,
} from "../modules/withdrawal/admin-withdrawal-executor.js";
import { parseLeaderWithdrawalCommand } from "../modules/withdrawal/leader-withdrawal-command.js";
import {
  executeLeaderWithdrawalCommand,
  LeaderWithdrawalCommandError,
} from "../modules/withdrawal/leader-withdrawal-executor.js";
import { parseAdminWithdrawalTaxReviewCommand } from "../modules/withdrawal/admin-withdrawal-tax-review-command.js";
import {
  AdminWithdrawalTaxReviewError,
  executeAdminWithdrawalTaxReviewCommand,
} from "../modules/withdrawal/admin-withdrawal-tax-review-executor.js";

type TaxRecordQuery = {
  page?: string; page_size?: string; keyword?: string;
  leader_user_id?: string; withdrawal_id?: string; source_type?: string; source_id?: string;
  tax_status?: string; tax_mode?: string; invoice_status?: string; from?: string; to?: string;
};

function maskPhone(phone?: string | null) {
  return phone ? phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2") : null;
}
function maskReference(ref?: string | null) {
  return ref
    ? ref.length <= 6
      ? "***"
      : `${ref.slice(0, 2)}***${ref.slice(-2)}`
    : null;
}
function statusText(status: string) {
  return (
    (
      {
        pending: "待审核",
        approved: "已通过",
        rejected: "已拒绝",
        paid: "已处理",
      } as Record<string, string>
    )[status] ?? status
  );
}
export function toLeaderWithdrawalDto(w: any, commissionCount = 0) {
  return {
    withdrawal_id: w.id,
    client_request_id: w.client_request_id,
    amount_cents: w.amount_cents,
    status: w.status,
    status_text: statusText(w.status),
    commission_count: commissionCount,
    created_at: w.created_at,
    reviewed_at: w.reviewed_at,
    processed_at: w.processed_at,
    rejection_reason: w.status === "rejected" ? "提现申请未通过，请联系平台" : undefined,
    manual_reference_masked: maskReference(w.manual_reference),
  };
}
type WithdrawalLinkWithOrder = {
  amount_cents: number;
  commission: {
    id: string;
    order_id: string;
    final_amount_cents: number;
    order: { order_no: string; pickup_store_id?: string | null; community_id?: string | null; community?: { name: string } | null; product?: { name: string } | null };
  };
};

type AdminWithdrawalQuery = { status?: string; leader_user_id?: string; client_request_id?: string; keyword?: string; from?: string; to?: string; page?: string; page_size?: string };

function httpError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }

async function getWithdrawalLinks(withdrawalId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.withdrawalCommission.findMany({
    where: { withdrawal_id: withdrawalId },
    include: { commission: { include: { order: { include: { product: true, community: true } } } } },
    orderBy: { created_at: "asc" }
  });
}

function linksInScope(links: WithdrawalLinkWithOrder[], context: ReturnType<typeof resolveAdminAccessContext>) {
  if (!context) return false;
  if (context.is_super_admin) return true;
  return links.length > 0 && links.every((link) => canAccessOrderDataScope(context, link.commission.order));
}

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

async function requireWithdrawalDataScope(withdrawalId: string, request: any) {
  const context = resolveAdminAccessContext(request);
  if (!context) throw httpError("ADMIN_UNAUTHORIZED: Admin identity required", 401);
  if (context.is_super_admin) return context;
  const links = await getWithdrawalLinks(withdrawalId);
  if (!linksInScope(links as unknown as WithdrawalLinkWithOrder[], context)) throw httpError(ADMIN_SCOPE_FORBIDDEN, 403);
  return context;
}

function adminWithdrawalDto(w: any, links: WithdrawalLinkWithOrder[]) {
  const communities = Array.from(new Set(links.map((link) => link.commission.order.community?.name).filter(Boolean)));
  return {
    withdrawal_id: w.id,
    client_request_id: w.client_request_id,
    leader_user_id: w.leader_user_id,
    leader_nickname: w.leader_user?.nickname ?? "",
    leader_phone_masked: maskPhone(w.leader_user?.phone),
    amount_cents: w.amount_cents,
    version: w.version,
    status: w.status,
    commission_count: links.length,
    community_names: communities,
    created_at: w.created_at,
    reviewed_at: w.reviewed_at,
    processed_at: w.processed_at,
    admin_remark: w.admin_remark
  };
}

function parseDateRange(query: { from?: string; to?: string }) {
  return {
    ...(query.from || query.to
      ? {
          created_at: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };
}

const DEFAULT_TAX_EXPORT_LIMIT = 10000;

function parsePage(query: { page?: string; page_size?: string }) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.page_size ?? "20", 10) || 20));
  return { page, pageSize };
}

function taxPayload(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function csvSafe(value: unknown) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function taxExportLimit(configuredLimit?: number): number {
  if (typeof configuredLimit === "number" && Number.isInteger(configuredLimit) && configuredLimit > 0) return configuredLimit;
  const configured = Number.parseInt(process.env.TAX_RECORD_EXPORT_LIMIT ?? "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_TAX_EXPORT_LIMIT;
}

export function ensureTaxExportWithinLimit<T>(records: T[], limit = taxExportLimit()) {
  if (records.length > limit) throw httpError(`导出匹配超过上限 ${limit} 条；请缩小时间或筛选范围后重试`, 422);
  return records;
}

function taxRecordDto(record: any, withdrawal?: any) {
  const payload = taxPayload(record.payload);
  const w = withdrawal ?? record.withdrawal;
  const links = (w?.commission_links ?? []) as WithdrawalLinkWithOrder[];
  const communities = Array.from(new Set(links.map((link) => link.commission.order.community?.name).filter(Boolean)));
  return {
    tax_record_id: record.id,
    withdrawal_id: record.source_type === "withdrawal" ? record.source_id : null,
    client_request_id: w?.client_request_id ?? payload.client_request_id ?? null,
    leader_user_id: record.leader_user_id,
    leader_nickname: w?.leader_user?.nickname ?? "",
    leader_phone_masked: maskPhone(w?.leader_user?.phone),
    gross_amount_cents: w?.amount_cents ?? record.amount_cents,
    taxable_amount_cents: w?.taxable_amount_cents ?? payload.taxable_amount_cents ?? record.amount_cents,
    tax_amount_cents: w?.tax_amount_cents ?? payload.tax_amount_cents ?? 0,
    payable_amount_cents: w?.payable_amount_cents ?? payload.payable_amount_cents ?? record.amount_cents,
    tax_mode: w?.tax_mode ?? record.tax_mode,
    tax_status: w?.tax_status ?? record.tax_status,
    tax_rate_basis: w?.tax_rate_basis ?? payload.tax_rate_basis ?? null,
    invoice_required: w?.invoice_required ?? payload.invoice_required ?? false,
    invoice_status: w?.invoice_status ?? payload.invoice_status ?? "not_required",
    tax_remark: w?.tax_remark ?? payload.tax_remark ?? null,
    reviewed_by_admin_id: w?.reviewed_by_admin_id ?? null,
    reviewed_at: w?.reviewed_at ?? null,
    withdrawal_status: w?.status ?? null,
    version: w?.version ?? 0,
    community_names: communities,
    created_at: record.created_at,
    processed_at: w?.processed_at ?? null,
    updated_at: w?.updated_at ?? record.updated_at,
  };
}

function taxScope(context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>) { return { isSuperAdmin: context.is_super_admin, communityIds: context.data_scope.community_ids, pickupStoreIds: context.data_scope.pickup_store_ids }; }
function taxFilters(query: TaxRecordQuery) { const dates=parseDateRange(query); return { sourceType: "withdrawal" as const, taxMode:query.tax_mode, taxStatus:query.tax_status, invoiceStatus:query.invoice_status, leaderUserId:query.leader_user_id, withdrawalId:query.withdrawal_id ?? query.source_id, keyword:query.keyword, createdAtFromInclusive:dates.created_at?.gte, createdAtToInclusive:dates.created_at?.lte }; }

async function executeReliableWithdrawal(
  request: any,
  reply: any,
  action: AdminWithdrawalAction,
) {
  const traceId = String(request.id);
  const context = resolveAdminAccessContext(request);
  if (!context) {
    reply.code(401);
    return contractFail({
      code: "ADMIN_UNAUTHORIZED",
      message: "管理员身份无效",
      traceId,
    });
  }
  const parsed = parseAdminWithdrawalCommand(action, request.body);
  if (!parsed.ok) {
    reply.code(400);
    return contractFail({
      code: parsed.code,
      message: parsed.message,
      traceId,
    });
  }
  const { id } = request.params as { id: string };
  try {
    const result = await executeAdminWithdrawalCommand({
      withdrawal_id: id,
      action,
      command: parsed.value,
      context,
      admin_meta: {
        ip_address: request.ip,
        user_agent:
          typeof request.headers["user-agent"] === "string"
            ? request.headers["user-agent"]
            : null,
      },
    });
    const response = {
      approve: {
        code: "ADMIN_WITHDRAWAL_APPROVED",
        message: "提现审核通过",
      },
      reject: {
        code: "ADMIN_WITHDRAWAL_REJECTED",
        message: "提现申请已拒绝",
      },
      "mark-paid": {
        code: "ADMIN_WITHDRAWAL_MARKED_PAID",
        message: "提现已标记为人工处理完成",
      },
    }[action];
    return contractOk(result, { ...response, traceId });
  } catch (error) {
    if (error instanceof AdminWithdrawalCommandError) {
      reply.code(error.statusCode);
      return contractFail({
        code: error.code,
        message: error.message,
        traceId,
      });
    }
    request.log.error(
      {
        error_name: error instanceof Error ? error.name : "UnknownError",
        withdrawal_id: id,
        action,
        trace_id: traceId,
      },
      "Admin withdrawal command failed",
    );
    reply.code(500);
    return contractFail({
      code: "ADMIN_WITHDRAWAL_EXECUTION_FAILED",
      message: "提现操作执行失败",
      traceId,
    });
  }
}

export function registerWithdrawalRoutes(app: FastifyInstance, options: { taxExportLimit?: number } = {}) {
  app.get("/api/leaders/me/withdrawals", (request, reply) =>
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
      const parsed = parseLeaderWithdrawalCommand(request.body);
      if (!parsed.ok) {
        throw publicCurrentUserError(parsed.message, 400);
      }
      try {
        return await executeLeaderWithdrawalCommand({
          leader_user_id: leader.id,
          command: parsed.value,
        });
      } catch (error) {
        if (error instanceof LeaderWithdrawalCommandError) {
          throw publicCurrentUserError(error.message, error.statusCode);
        }
        throw error;
      }
    }),
  );

  app.get(
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

  app.get(
    "/api/admin/withdrawals/:id",
    { preHandler: requireAdminPermission("withdrawal.view") },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        await requireWithdrawalDataScope(id, request);
        const withdrawal = await prisma.withdrawal.findUnique({ where: { id }, include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } } });
        if (!withdrawal) { reply.code(404); return fail("提现申请不存在"); }
        const links = withdrawal.commission_links as unknown as WithdrawalLinkWithOrder[];
        const ledgers = await prisma.rewardLedger.findMany({ where: { withdrawal_id: id }, orderBy: { created_at: "asc" }, select: { id: true, event_type: true, entry_type: true, direction: true, amount_cents: true, affects_available_balance: true, idempotency_key: true, created_at: true } });
        const audits = await prisma.adminAuditLog.findMany({ where: { target_type: "Withdrawal", target_id: id }, orderBy: { created_at: "asc" }, select: { action: true, admin_user_id: true, created_at: true } });
        return ok({
          ...adminWithdrawalDto(withdrawal, links),
          reviewed_by_admin_id: withdrawal.reviewed_by_admin_id,
          processed_by_admin_id: withdrawal.processed_by_admin_id,
          manual_reference: withdrawal.manual_reference,
          commissions: links.map((link) => ({ commission_id: link.commission.id, order_no: link.commission.order.order_no, product_name: link.commission.order.product?.name ?? "", community_name: link.commission.order.community?.name ?? "", amount_cents: link.amount_cents })),
          reward_ledger_events: ledgers,
          admin_audits: audits
        });
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "查询提现详情失败");
      }
    },
  );

  app.get(
    "/api/admin/tax-records",
    { preHandler: requireAdminPermission("finance.view") },
    async (request, reply) => {
      try {
        const query = request.query as TaxRecordQuery;
        const context = resolveAdminAccessContext(request)!;
        const { page, pageSize } = parsePage(query);
        const filters = taxFilters(query);
        const { total, records, withdrawals } = await prisma.$transaction(async (tx) => {
          const total = await countScopedTaxRecords(tx, taxScope(context), filters);
          const selectedIds = (await listScopedTaxRecordIds(tx, taxScope(context), filters, (page - 1) * pageSize, pageSize)).map((item) => item.id);
          const hydrated = await tx.taxRecord.findMany({ where: { id: { in: selectedIds } } });
          const records = restoreSelectedIdOrder(selectedIds, hydrated);
          const withdrawals = await tx.withdrawal.findMany({
            where: { id: { in: records.map((record) => record.source_id) } },
            include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } },
          });
          return { total, records, withdrawals };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        const map = new Map(withdrawals.map((w) => [w.id, w]));
        return ok({ items: records.map((record) => taxRecordDto(record, map.get(record.source_id))), total, page, page_size: pageSize });
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "查询税务记录失败");
      }
    },
  );

  app.get(
    "/api/admin/tax-records/export.csv",
    { preHandler: requireAdminPermission("finance.export") },
    async (request, reply) => {
      try {
        const query = request.query as TaxRecordQuery;
        const context = resolveAdminAccessContext(request)!;
        const limit = taxExportLimit(options.taxExportLimit);
        const { exportRecords, withdrawals } = await prisma.$transaction(async (tx) => {
          const selectedIds = (await listScopedTaxRecordIds(tx, taxScope(context), taxFilters(query), 0, limit + 1)).map((item) => item.id);
          const hydrated = await tx.taxRecord.findMany({ where: { id: { in: selectedIds } } });
          const exportRecords = restoreSelectedIdOrder(selectedIds, hydrated);
          const withdrawals = await tx.withdrawal.findMany({ where: { id: { in: exportRecords.map((record) => record.source_id) } }, include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } } });
          return { exportRecords, withdrawals };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
        let records: typeof exportRecords;
        try {
          records = ensureTaxExportWithinLimit(exportRecords, limit);
        } catch (error) {
          reply.code((error as { statusCode?: number }).statusCode ?? 422);
          return fail(error instanceof Error ? error.message : "导出记录超过上限");
        }
        const total = records.length;
        const map = new Map(withdrawals.map((w) => [w.id, w]));
        const rows = records.map((record) => taxRecordDto(record, map.get(record.source_id)));
        const header = ["说明","税务记录ID","提现ID","申请编号","Leader","手机号(脱敏)","总金额(分)","应税金额(分)","人工确认税额(分)","实际应付金额(分)","税务模式","税务状态","税率/依据","是否需发票","发票状态","备注","社区","创建时间"];
        const notice = "仅供内部人工核对，不构成税务申报结果。系统不会自动报税，不会连接外部税务平台，不会自动发起打款。";
        const csv = "\ufeff" + [header, ...rows.map((r) => [notice, r.tax_record_id, r.withdrawal_id, r.client_request_id, r.leader_nickname, r.leader_phone_masked, r.gross_amount_cents, r.taxable_amount_cents, r.tax_amount_cents, r.payable_amount_cents, r.tax_mode, r.tax_status, r.tax_rate_basis, r.invoice_required ? "是" : "否", r.invoice_status, r.tax_remark, r.community_names.join("、"), r.created_at])].map((row) => row.map(csvSafe).join(",")).join("\n");
        const date = new Date().toISOString().slice(0, 10);
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="tax-review-${date}.csv"`);
        reply.header("x-export-total", String(total));
        reply.header("x-export-truncated", "false");
        return reply.send(csv);
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "导出税务记录失败");
      }
    },
  );

  app.get(
    "/api/admin/tax-records/:id",
    { preHandler: requireAdminPermission("finance.view") },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const record = await prisma.taxRecord.findUnique({ where: { id } });
        if (!record || record.source_type !== "withdrawal") throw httpError("税务记录不存在", 404);
        await requireWithdrawalDataScope(record.source_id, request);
        const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: record.source_id }, include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } } });
        const audits = await prisma.adminAuditLog.findMany({ where: { target_type: "Withdrawal", target_id: withdrawal.id }, orderBy: { created_at: "desc" }, take: 20, select: { action: true, admin_user_id: true, created_at: true } });
        const events = await prisma.businessEventLog.findMany({ where: { withdrawal_id: withdrawal.id }, orderBy: { created_at: "desc" }, take: 20, select: { event_type: true, event_level: true, created_at: true } });
        return ok({ ...taxRecordDto(record, withdrawal), commissions: withdrawal.commission_links.map((link: any) => ({ commission_id: link.commission_id, order_no: link.commission.order.order_no, community_name: link.commission.order.community?.name ?? "", product_name: link.commission.order.product?.name ?? "", reward_amount_cents: link.amount_cents })), admin_audits: audits, business_events: events });
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "查询税务详情失败");
      }
    },
  );

  app.post(
    "/api/admin/withdrawals/:id/reject",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    (request, reply) =>
      executeReliableWithdrawal(request, reply, "reject"),
  );

  app.post(
    "/api/admin/withdrawals/:id/tax-review",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: "ADMIN_UNAUTHORIZED",
          message: "管理员身份无效",
          traceId,
        });
      }
      const parsed = parseAdminWithdrawalTaxReviewCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }
      const { id } = request.params as { id: string };
      try {
        const reviewed = await executeAdminWithdrawalTaxReviewCommand({
          withdrawal_id: id,
          command: parsed.value,
          context,
          admin_meta: {
            ip_address: request.ip,
            user_agent:
              typeof request.headers["user-agent"] === "string"
                ? request.headers["user-agent"]
                : null,
          },
        });
        return contractOk(reviewed, {
          code: "ADMIN_WITHDRAWAL_TAX_REVIEWED",
          message: "提现税务复核已保存",
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminWithdrawalTaxReviewError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        request.log.error(
          {
            error_name: error instanceof Error ? error.name : "UnknownError",
            withdrawal_id: id,
            trace_id: traceId,
          },
          "Admin withdrawal tax review failed",
        );
        reply.code(500);
        return contractFail({
          code: "ADMIN_WITHDRAWAL_TAX_REVIEW_FAILED",
          message: "提现税务复核失败",
          traceId,
        });
      }
    },
  );

  app.post(
    "/api/admin/withdrawals/:id/approve",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    (request, reply) =>
      executeReliableWithdrawal(request, reply, "approve"),
  );

  app.post(
    "/api/admin/withdrawals/:id/mark-paid",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    (request, reply) =>
      executeReliableWithdrawal(request, reply, "mark-paid"),
  );
}

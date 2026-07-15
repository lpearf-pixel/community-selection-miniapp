import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { fail, ok } from "@community-selection/shared";
import { prisma } from "../db.js";
import {
  safeRecordBusinessEvent,
  safeRecordOrderTimeline,
} from "../services/logging-service.js";
import {
  appendRewardLedgerEntry,
  getAvailableRewardBalance,
} from "../services/commission-service.js";
import {
  ADMIN_SCOPE_FORBIDDEN,
  canAccessOrderDataScope,
  requireAdminPermission,
  resolveAdminAccessContext,
} from "../modules/admin-access/admin-access-control.js";

type WithdrawBody = {
  leader_user_id?: string;
  openid?: string;
  amount_cents?: number;
  client_request_id?: string;
  commission_ids?: string[];
};
type ReviewBody = {
  admin_user_id?: string;
  reason?: string;
  remark?: string;
  manual_reference?: string;
};
type TaxReviewBody = {
  tax_mode?: "none" | "withheld" | "invoice";
  tax_status?: string;
  taxable_amount_cents?: number;
  tax_amount_cents?: number;
  tax_rate_basis?: string;
  invoice_required?: boolean;
  invoice_status?: string;
  tax_remark?: string;
  client_request_id?: string;
  expected_updated_at?: string;
};
type TaxRecordQuery = {
  page?: string; page_size?: string; keyword?: string;
  leader_user_id?: string; withdrawal_id?: string; source_type?: string; source_id?: string;
  tax_status?: string; tax_mode?: string; invoice_status?: string; from?: string; to?: string;
};

async function resolveCurrentLeader(request: {
  headers: Record<string, unknown>;
}) {
  const openid =
    typeof request.headers["x-openid"] === "string"
      ? request.headers["x-openid"].trim()
      : "";
  if (!openid)
    throw Object.assign(new Error("LEADER_UNAUTHORIZED: 缺少身份"), {
      statusCode: 401,
    });
  const user = await prisma.user.findUnique({ where: { openid } });
  if (!user)
    throw Object.assign(new Error("LEADER_UNAUTHORIZED: 用户不存在"), {
      statusCode: 401,
    });
  if (user.role !== "leader")
    throw Object.assign(new Error("LEADER_FORBIDDEN: 仅开团人可操作"), {
      statusCode: 403,
    });
  return user;
}

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
function leaderWithdrawalDto(w: any, commissionCount = 0) {
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
    rejection_reason: w.status === "rejected" ? w.admin_remark : undefined,
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

function restoreMarkPaidTransactionError(error: unknown) {
  const message = error instanceof Error ? error.message : "标记提现处理失败";
  const statusCode = (error as { statusCode?: number })?.statusCode;
  if (statusCode) return { message, statusCode };
  if (message === "ADMIN_UNAUTHORIZED: Admin identity required") return { message, statusCode: 401 };
  if (message === ADMIN_SCOPE_FORBIDDEN) return { message, statusCode: 403 };
  if (message === "提现申请不存在") return { message, statusCode: 404 };
  const conflictMessages = new Set([
    "仅审核通过的提现申请可标记已处理",
    "提现税务状态未完成或未计算，不能标记已处理",
    "可处理金额不能小于 0",
    "发票状态未确认，不能标记已处理",
    "提现状态已变化，请刷新后重试",
    "提现关联奖励状态已变化，请人工复核",
  ]);
  return { message, statusCode: conflictMessages.has(message) ? 409 : 400 };
}

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
    status: w.status,
    commission_count: links.length,
    community_names: communities,
    created_at: w.created_at,
    reviewed_at: w.reviewed_at,
    processed_at: w.processed_at,
    admin_remark: w.admin_remark
  };
}

async function getCommissionAvailableNet(tx: Prisma.TransactionClient, commissionId: string) {
  const entries = await tx.rewardLedger.findMany({ where: { commission_id: commissionId, affects_available_balance: true }, select: { direction: true, amount_cents: true } });
  return entries.reduce((sum, entry) => sum + (entry.direction === "in" ? entry.amount_cents : -entry.amount_cents), 0);
}

async function persistLedgerMismatch(leaderUserId: string, payload: Record<string, unknown>) {
  await safeRecordBusinessEvent(prisma, { event_type: "withdrawal_ledger_mismatch", event_level: "warning", event_source: "withdrawals-route", leader_user_id: leaderUserId, payload });
}

async function idempotentWithdrawalByClientRequest(clientRequestId: string, leaderUserId: string) {
  const existing = await prisma.withdrawal.findUnique({ where: { client_request_id: clientRequestId } });
  if (!existing) return null;
  if (existing.leader_user_id !== leaderUserId) throw httpError("client_request_id 已被使用", 409);
  const count = await prisma.withdrawalCommission.count({ where: { withdrawal_id: existing.id } });
  return { ...leaderWithdrawalDto(existing, count), applied: false, idempotent: true };
}

async function loadWithdrawalOrThrow(tx: Prisma.TransactionClient, id: string) {
  const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
  if (!withdrawal) throw new Error("提现申请不存在");
  return withdrawal;
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("提现金额必须大于 0");
  return amount;
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

const TAX_MODES = new Set(["none", "withheld", "invoice"]);
const TAX_STATUSES = new Set(["pending", "calculated", "pending_invoice", "completed"]);
const INVOICE_STATUSES = new Set(["not_required", "pending", "verified", "rejected"]);
const TAX_REVIEW_IDEMPOTENCY_LIMIT = 100;
const DEFAULT_TAX_EXPORT_LIMIT = 10000;
const MAX_PRISMA_INT = 2_147_483_647;

function resolveTaxStatus(body: { tax_mode?: string; invoice_status?: string }) {
  if (body.tax_mode === "withheld") return "calculated";
  if (body.tax_mode === "none") return "completed";
  if (body.tax_mode === "invoice") return body.invoice_status === "verified" ? "completed" : "pending_invoice";
  throw httpError("税务处理方式不合法", 400);
}

function parseTaxReviewClientRequestId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 80) throw httpError("client_request_id 必填且 trim 后长度必须为 1-80", 400);
  return id;
}

function parseExpectedUpdatedAt(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw httpError("expected_updated_at 必填且必须来自详情接口", 400);
  return date;
}

function parseRequiredMoneyCents(body: Record<string, unknown>, fieldName: "taxable_amount_cents" | "tax_amount_cents") {
  if (!Object.hasOwn(body, fieldName)) throw httpError(`${fieldName} 必填`, 400);
  const value = body[fieldName];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw httpError(`${fieldName} 必须为安全整数分`, 400);
  if (value < 0) throw httpError(`${fieldName} 不能小于 0`, 400);
  if (value > MAX_PRISMA_INT) throw httpError(`${fieldName} 超出数据库整数范围`, 400);
  return value;
}

type ReviewRequestHistory = Record<string, { snapshot: unknown; reviewed_at: string; reviewed_by_admin_id: string }>;
function reviewRequestsFromPayload(payload: Record<string, any>): ReviewRequestHistory {
  const value = payload.review_requests;
  return value && typeof value === "object" && !Array.isArray(value) ? value as ReviewRequestHistory : {};
}

function hasReviewRequest(requests: ReviewRequestHistory, key: string) {
  return Object.hasOwn(requests, key);
}

function validateTaxCombination(taxMode: string, invoiceRequired: boolean, invoiceStatus: string, taxStatus: string) {
  if (!TAX_MODES.has(taxMode)) throw httpError("税务处理方式不合法", 400);
  if (!INVOICE_STATUSES.has(invoiceStatus)) throw httpError("发票状态不合法", 400);
  if (!TAX_STATUSES.has(taxStatus)) throw httpError("税务状态不合法", 400);
  if (taxMode !== "invoice" && (invoiceRequired || invoiceStatus !== "not_required")) throw httpError("非发票税务模式不允许要求发票", 400);
  if (taxMode === "invoice" && !invoiceRequired) throw httpError("发票税务模式必须要求发票", 400);
  if (taxStatus !== resolveTaxStatus({ tax_mode: taxMode, invoice_status: invoiceStatus })) throw httpError("税务状态与税务模式/发票状态不匹配", 400);
}

function parsePage(query: { page?: string; page_size?: string }) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.page_size ?? "20", 10) || 20));
  return { page, pageSize };
}

function taxPayload(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function taxReviewSnapshot(input: { tax_mode: string; tax_status: string; taxable_amount_cents: number; tax_amount_cents: number; tax_rate_basis: string | null; invoice_required: boolean; invoice_status: string; tax_remark: string | null }) {
  return input;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      jsonValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

function csvSafe(value: unknown) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function taxExportLimit(configuredLimit?: number) {
  if (Number.isInteger(configuredLimit) && configuredLimit > 0) return configuredLimit;
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
    community_names: communities,
    created_at: record.created_at,
    processed_at: w?.processed_at ?? null,
    updated_at: w?.updated_at ?? record.updated_at,
  };
}

async function buildTaxRecordWhere(query: TaxRecordQuery, context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>): Promise<Prisma.TaxRecordWhereInput> {
  const withdrawalWhere: Prisma.WithdrawalWhereInput = {
    ...withdrawalScopeWhere(context),
    ...(query.keyword ? { OR: [
      { client_request_id: { contains: query.keyword, mode: "insensitive" } },
      { id: { contains: query.keyword, mode: "insensitive" } },
      { leader_user: { nickname: { contains: query.keyword, mode: "insensitive" } } },
      { leader_user: { phone: { contains: query.keyword, mode: "insensitive" } } },
    ] } : {}),
    ...(query.tax_mode ? { tax_mode: query.tax_mode } : {}),
    ...(query.tax_status ? { tax_status: query.tax_status } : {}),
    ...(query.invoice_status ? { invoice_status: query.invoice_status } : {}),
    ...(query.leader_user_id ? { leader_user_id: query.leader_user_id } : {}),
    ...(query.withdrawal_id || query.source_id ? { id: query.withdrawal_id ?? query.source_id } : {}),
  };
  return {
    source_type: "withdrawal",
    ...(query.leader_user_id ? { leader_user_id: query.leader_user_id } : {}),
    ...(query.tax_status ? { tax_status: query.tax_status } : {}),
    ...(query.tax_mode ? { tax_mode: query.tax_mode } : {}),
    ...parseDateRange(query),
    source_id: { in: (await prisma.withdrawal.findMany({ where: withdrawalWhere, select: { id: true } })).map((item) => item.id) },
  };
}

function uniqueOrderIds(orderIds: Array<string | null | undefined> = []) {
  return Array.from(
    new Set(orderIds.filter((orderId): orderId is string => Boolean(orderId))),
  );
}

async function logWithdrawalEvent(
  tx: Prisma.TransactionClient,
  input: {
    event_type: string;
    withdrawal: {
      id: string;
      leader_user_id: string;
      amount_cents: number;
      status: string;
    };
    commissionIds?: string[];
    orderIds?: string[];
    admin_user_id?: string | null;
    extraPayload?: Record<string, unknown>;
    before?: unknown;
    after?: unknown;
    message?: string;
  },
) {
  const orderIds = uniqueOrderIds(input.orderIds);
  const payload = {
    withdrawal_id: input.withdrawal.id,
    amount_cents: input.withdrawal.amount_cents,
    commission_ids: input.commissionIds ?? [],
    order_ids: orderIds,
    action: input.event_type,
    status: input.withdrawal.status,
    admin_user_id: input.admin_user_id ?? null,
    ...(input.extraPayload ?? {}),
    ...(input.event_type === "withdrawal_mark_paid" &&
    "tax_amount_cents" in input.withdrawal
      ? {
          gross_amount_cents: input.withdrawal.amount_cents,
          tax_amount_cents:
            (input.withdrawal as { tax_amount_cents?: number })
              .tax_amount_cents ?? 0,
          payable_amount_cents:
            (input.withdrawal as { payable_amount_cents?: number })
              .payable_amount_cents ?? input.withdrawal.amount_cents,
          tax_mode: (input.withdrawal as { tax_mode?: string }).tax_mode,
          tax_status: (input.withdrawal as { tax_status?: string }).tax_status,
          invoice_status: (input.withdrawal as { invoice_status?: string })
            .invoice_status,
        }
      : {}),
  };
  await safeRecordBusinessEvent(tx, {
    event_type: input.event_type,
    event_source: "withdrawals-route",
    withdrawal_id: input.withdrawal.id,
    leader_user_id: input.withdrawal.leader_user_id,
    before_snapshot: input.before,
    after_snapshot: input.after ?? input.withdrawal,
    payload,
    message: input.message ?? null,
  });
  for (const orderId of orderIds) {
    await safeRecordBusinessEvent(tx, {
      event_type: input.event_type,
      event_source: "withdrawals-route",
      order_id: orderId,
      withdrawal_id: input.withdrawal.id,
      leader_user_id: input.withdrawal.leader_user_id,
      before_snapshot: input.before,
      after_snapshot: input.after ?? input.withdrawal,
      payload,
      message: input.message ?? null,
    });
    await safeRecordOrderTimeline(tx, {
      order_id: orderId,
      event_type: input.event_type,
      title:
        input.event_type === "withdrawal_requested"
          ? "开团服务奖励提现申请已提交"
          : "开团服务奖励提现状态已更新",
      payload: {
        withdrawal_id: input.withdrawal.id,
        amount_cents: input.withdrawal.amount_cents,
        status: input.withdrawal.status,
      },
    });
  }
}

async function writeAdminAuditLog(
  tx: Prisma.TransactionClient,
  request: {
    adminUser?: { id: string };
    ip?: string;
    headers: Record<string, unknown>;
  },
  input: { action: string; target_id: string; payload?: unknown },
) {
  await tx.adminAuditLog.create({
    data: {
      admin_user_id: resolveAdminAccessContext(request as any)?.admin_user_id ?? request.adminUser?.id ?? null,
      action: input.action,
      target_type: "Withdrawal",
      target_id: input.target_id,
      ip_address: request.ip ?? null,
      user_agent:
        typeof request.headers["user-agent"] === "string"
          ? request.headers["user-agent"]
          : null,
      payload:
        input.payload === undefined
          ? Prisma.JsonNull
          : (input.payload as Prisma.InputJsonValue),
    },
  });
}

export function registerWithdrawalRoutes(app: FastifyInstance, options: { taxExportLimit?: number } = {}) {
  app.get("/api/leaders/me/withdrawals", async (request, reply) => {
    try {
      const leader = await resolveCurrentLeader(request);
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
      return ok(
        withdrawals.map((w) => leaderWithdrawalDto(w, countMap.get(w.id) ?? 0)),
      );
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : "查询提现申请失败");
    }
  });

  app.get("/api/leaders/me/withdrawals/:id", async (request, reply) => {
    try {
      const leader = await resolveCurrentLeader(request);
      const { id } = request.params as { id: string };
      const w = await prisma.withdrawal.findFirst({
        where: { id, leader_user_id: leader.id },
      });
      if (!w) {
        reply.code(404);
        return fail("提现申请不存在");
      }
      const count = await prisma.withdrawalCommission.count({ where: { withdrawal_id: id } });
      return ok(leaderWithdrawalDto(w, count));
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : "查询提现申请失败");
    }
  });

  app.get(
    "/api/leaders/me/withdrawable-commissions",
    async (request, reply) => {
      try {
        const leader = await resolveCurrentLeader(request);
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
        return ok({
          available_balance_cents: balance,
          commission_count: commissions.length,
          items: commissions.map((c) => ({
            commission_id: c.id,
            order_no: c.order.order_no,
            product_name: c.order.product?.name ?? "",
            final_amount_cents: c.final_amount_cents,
            available_at: c.available_at,
            community_name: c.order.community?.name ?? "",
          })),
        });
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(
          error instanceof Error ? error.message : "查询可提现开团服务奖励失败",
        );
      }
    },
  );

  app.post("/api/leaders/me/withdrawals", async (request, reply) => {
    try {
      const leader = await resolveCurrentLeader(request);
      const body = request.body as WithdrawBody;
      const clientRequestId = String(body.client_request_id ?? "").trim();
      if (!clientRequestId || clientRequestId.length > 80) throw new Error("client_request_id 必填且长度不能超过 80");
      const quick = await idempotentWithdrawalByClientRequest(clientRequestId, leader.id);
      if (quick) return ok(quick);
      const ids = Array.from(new Set((body.commission_ids ?? []).map(String).filter(Boolean)));
      if (ids.length === 0) throw new Error("commission_ids 至少选择一条");

      try {
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const selected = await tx.commission.findMany({ where: { id: { in: ids }, leader_user_id: leader.id, status: "available", withdrawal_id: null, final_amount_cents: { gt: 0 } }, orderBy: { created_at: "asc" } });
          if (selected.length !== ids.length) throw new Error("存在不可提现或已占用的开团服务奖励");
          const amount = selected.reduce((sum, item) => sum + item.final_amount_cents, 0);
          if (body.amount_cents !== undefined && parseAmount(body.amount_cents) !== amount) throw new Error("提现金额必须精确匹配整笔开团服务奖励合计");

          const mismatches: Array<{ commission_id: string; expected_cents: number; ledger_net_cents: number }> = [];
          for (const item of selected) {
            const net = await getCommissionAvailableNet(tx, item.id);
            if (net !== item.final_amount_cents) mismatches.push({ commission_id: item.id, expected_cents: item.final_amount_cents, ledger_net_cents: net });
          }
          if (mismatches.length > 0) throw httpError(`LEDGER_MISMATCH:${JSON.stringify({ mismatches, requested_amount_cents: amount })}`, 409);

          const availableBalance = await getAvailableRewardBalance(tx, leader.id);
          if (availableBalance < amount) throw httpError(`LEDGER_MISMATCH:${JSON.stringify({ available_balance_cents: availableBalance, requested_amount_cents: amount })}`, 409);

          const created = await tx.withdrawal.create({ data: { leader_user_id: leader.id, client_request_id: clientRequestId, amount_cents: amount, status: "pending", taxable_amount_cents: amount, tax_amount_cents: 0, payable_amount_cents: amount, tax_mode: "pending_review", tax_status: "pending", invoice_required: false, invoice_status: "not_required" } });
          const claimed = await tx.commission.updateMany({ where: { id: { in: ids }, status: "available", withdrawal_id: null }, data: { status: "withdrawing", withdrawal_id: created.id } });
          if (claimed.count !== ids.length) throw httpError("开团服务奖励已被其他提现申请占用", 409);
          await tx.withdrawalCommission.createMany({ data: selected.map((item) => ({ withdrawal_id: created.id, commission_id: item.id, amount_cents: item.final_amount_cents })), skipDuplicates: true });
          await appendRewardLedgerEntry(tx, { leader_user_id: leader.id, withdrawal_id: created.id, event_type: "withdrawal_reserved", entry_type: "withdrawal_reserved", direction: "out", amount_cents: amount, affects_available_balance: true, idempotency_key: `withdrawal-reserved:${created.id}` });
          await logWithdrawalEvent(tx, { event_type: "withdrawal_requested", withdrawal: created, commissionIds: ids, orderIds: selected.map((i) => i.order_id), after: created });
          return created;
        });
        return ok({ ...leaderWithdrawalDto(result, ids.length), applied: true, idempotent: false });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await idempotentWithdrawalByClientRequest(clientRequestId, leader.id);
          if (existing) return ok(existing);
        }
        if (error instanceof Error && error.message.startsWith("LEDGER_MISMATCH:")) {
          const payload = JSON.parse(error.message.slice("LEDGER_MISMATCH:".length));
          await persistLedgerMismatch(leader.id, payload);
          throw new Error("奖励账本待人工复核");
        }
        throw error;
      }
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : "提交提现申请失败");
    }
  });

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
        const where = await buildTaxRecordWhere(query, context);
        const [total, records] = await prisma.$transaction([
          prisma.taxRecord.count({ where }),
          prisma.taxRecord.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ]);
        const withdrawals = await prisma.withdrawal.findMany({
          where: { id: { in: records.map((record) => record.source_id) } },
          include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } },
        });
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
        const where = await buildTaxRecordWhere(query, context);
        const limit = taxExportLimit(options.taxExportLimit);
        const exportRecords = await prisma.taxRecord.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: limit + 1 });
        let records: typeof exportRecords;
        try {
          records = ensureTaxExportWithinLimit(exportRecords, limit);
        } catch (error) {
          reply.code((error as { statusCode?: number }).statusCode ?? 422);
          return fail(error instanceof Error ? error.message : "导出记录超过上限");
        }
        const total = records.length;
        const withdrawals = await prisma.withdrawal.findMany({ where: { id: { in: records.map((record) => record.source_id) } }, include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } } });
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
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as ReviewBody;
        const reason = String(body.reason ?? body.remark ?? "").trim();
        if (!reason) throw new Error("拒绝原因必填");
        const rejected = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await requireWithdrawalDataScope(id, request);
          const before = await loadWithdrawalOrThrow(tx, id);
          if (before.status === "rejected") return { withdrawal: before, idempotent: true };
          if (before.status !== "pending") throw httpError("当前提现申请不可拒绝", 409);
          const context = resolveAdminAccessContext(request)!;
          const claimed = await tx.withdrawal.updateMany({ where: { id, status: "pending" }, data: { status: "rejected", admin_remark: reason.slice(0, 200), rejected_at: new Date(), reviewed_by_admin_id: context.admin_user_id, reviewed_at: new Date() } });
          if (claimed.count !== 1) throw httpError("提现状态已变化，请刷新后重试", 409);
          const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
          const links = await getWithdrawalLinks(id, tx);
          const restored = await tx.commission.updateMany({ where: { id: { in: links.map((link) => link.commission_id) }, withdrawal_id: id, status: "withdrawing" }, data: { status: "available", withdrawal_id: null } });
          if (restored.count !== links.length) throw httpError("提现关联奖励状态已变化，请人工复核", 409);
          await appendRewardLedgerEntry(tx, { leader_user_id: before.leader_user_id, withdrawal_id: id, event_type: "withdrawal_rejected_restore", entry_type: "withdrawal_rejected_restore", direction: "in", amount_cents: before.amount_cents, affects_available_balance: true, idempotency_key: `withdrawal-rejected-restore:${id}` });
          await writeAdminAuditLog(tx, request, { action: "withdrawal_rejected", target_id: id, payload: { reason } });
          await logWithdrawalEvent(tx, { event_type: "withdrawal_rejected", withdrawal: updated, commissionIds: links.map((link) => link.commission_id), orderIds: links.map((link) => link.commission.order_id), before, after: updated, admin_user_id: context.admin_user_id });
          return { withdrawal: updated, idempotent: false };
        });
        return ok(rejected);
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "拒绝提现申请失败");
      }
    },
  );

  app.post(
    "/api/admin/withdrawals/:id/tax-review",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as TaxReviewBody;
        const context = resolveAdminAccessContext(request)!;
        await requireWithdrawalDataScope(id, request);
        const clientRequestId = parseTaxReviewClientRequestId(body.client_request_id);
        const taxMode = String(body.tax_mode ?? "");
        if (!TAX_MODES.has(taxMode)) throw httpError("税务处理方式不合法", 400);
        const baseWithdrawal = await prisma.withdrawal.findUnique({ where: { id } });
        if (!baseWithdrawal) throw httpError("提现申请不存在", 404);
        const bodyRecord = body as Record<string, unknown>;
        const taxableAmount = parseRequiredMoneyCents(bodyRecord, "taxable_amount_cents");
        const taxAmount = parseRequiredMoneyCents(bodyRecord, "tax_amount_cents");
        if (taxableAmount > baseWithdrawal.amount_cents) throw httpError("应税金额不能超过提现金额", 400);
        if (taxAmount > taxableAmount) throw httpError("税务金额不能超过应税金额", 400);
        if (taxMode === "none" && taxAmount !== 0) throw httpError("无税务扣减模式的税额必须为 0", 400);
        const payableAmount = baseWithdrawal.amount_cents - taxAmount;
        if (payableAmount < 0) throw httpError("实际应付金额不能小于 0", 400);
        const invoiceRequired = taxMode === "invoice";
        const invoiceStatus = taxMode === "invoice" ? (body.invoice_status && body.invoice_status !== "not_required" ? String(body.invoice_status) : "pending") : "not_required";
        const taxStatus = resolveTaxStatus({ tax_mode: taxMode, invoice_status: invoiceStatus });
        validateTaxCombination(taxMode, invoiceRequired, invoiceStatus, taxStatus);
        const requested = taxReviewSnapshot({ tax_mode: taxMode, tax_status: taxStatus, taxable_amount_cents: taxableAmount, tax_amount_cents: taxAmount, tax_rate_basis: body.tax_rate_basis ?? null, invoice_required: invoiceRequired, invoice_status: invoiceStatus, tax_remark: body.tax_remark ?? null });

        async function currentIdempotency() {
          const existing = await prisma.taxRecord.findUnique({ where: { source_type_source_id: { source_type: "withdrawal", source_id: id } } });
          const requests = reviewRequestsFromPayload(taxPayload(existing?.payload));
          const previous = hasReviewRequest(requests, clientRequestId) ? requests[clientRequestId] : undefined;
          return { existing, previous };
        }
        const quick = await currentIdempotency();
        if (quick.previous) {
          if (!jsonValuesEqual(quick.previous.snapshot, requested)) throw httpError("client_request_id 对应的税务复核内容不一致", 409);
          return ok({ withdrawal: baseWithdrawal, tax_record: quick.existing, idempotent: true });
        }
        if (baseWithdrawal.status !== "pending" && baseWithdrawal.status !== "approved") throw httpError("当前提现申请不可做税务复核", 409);
        const expectedUpdatedAt = parseExpectedUpdatedAt(body.expected_updated_at);

        try {
          const reviewed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
            if (!withdrawal) throw httpError("提现申请不存在", 404);
            const existing = await tx.taxRecord.findUnique({ where: { source_type_source_id: { source_type: "withdrawal", source_id: withdrawal.id } } });
            const existingPayload = taxPayload(existing?.payload);
            const reviewRequests = reviewRequestsFromPayload(existingPayload);
            const previous = hasReviewRequest(reviewRequests, clientRequestId) ? reviewRequests[clientRequestId] : undefined;
            if (previous) {
              if (!jsonValuesEqual(previous.snapshot, requested)) throw httpError("client_request_id 对应的税务复核内容不一致", 409);
              return { withdrawal, tax_record: existing, idempotent: true };
            }
            if (Object.keys(reviewRequests).length >= TAX_REVIEW_IDEMPOTENCY_LIMIT) throw httpError(`税务复核幂等历史已达上限 ${TAX_REVIEW_IDEMPOTENCY_LIMIT}，请联系管理员处理`, 409);
            const claimed = await tx.withdrawal.updateMany({
              where: { id, updated_at: expectedUpdatedAt },
              data: { tax_mode: taxMode, tax_status: taxStatus, taxable_amount_cents: taxableAmount, tax_amount_cents: taxAmount, payable_amount_cents: payableAmount, tax_rate_basis: body.tax_rate_basis ?? null, invoice_required: invoiceRequired, invoice_status: invoiceStatus, tax_remark: body.tax_remark ?? null, reviewed_by_admin_id: context.admin_user_id, reviewed_at: new Date() },
            });
            if (claimed.count !== 1) throw httpError("提现税务状态已变化，请刷新后重试", 409);
            const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
            const nextRequests = { ...reviewRequests, [clientRequestId]: { snapshot: requested, reviewed_at: new Date().toISOString(), reviewed_by_admin_id: context.admin_user_id } };
            const recordPayload = { ...existingPayload, ...requested, client_request_id: clientRequestId, review_snapshot: requested, review_requests: nextRequests, notice: "仅供内部人工核对，不构成税务申报结果。系统不会自动报税，不会连接外部税务平台，不会自动发起打款。" };
            const taxRecord = await tx.taxRecord.upsert({
              where: { source_type_source_id: { source_type: "withdrawal", source_id: withdrawal.id } },
              update: { leader_user_id: withdrawal.leader_user_id, tax_mode: taxMode, tax_status: taxStatus, amount_cents: withdrawal.amount_cents, payload: recordPayload },
              create: { leader_user_id: withdrawal.leader_user_id, source_type: "withdrawal", source_id: withdrawal.id, tax_mode: taxMode, tax_status: taxStatus, amount_cents: withdrawal.amount_cents, payload: recordPayload },
            });
            const links = await getWithdrawalLinks(id, tx);
            await writeAdminAuditLog(tx, request, { action: "withdrawal_tax_reviewed", target_id: id, payload: { before: taxReviewSnapshot({ tax_mode: withdrawal.tax_mode, tax_status: withdrawal.tax_status, taxable_amount_cents: withdrawal.taxable_amount_cents, tax_amount_cents: withdrawal.tax_amount_cents, tax_rate_basis: withdrawal.tax_rate_basis, invoice_required: withdrawal.invoice_required, invoice_status: withdrawal.invoice_status, tax_remark: withdrawal.tax_remark }), after: requested, client_request_id: clientRequestId } });
            await logWithdrawalEvent(tx, { event_type: "withdrawal_tax_reviewed", withdrawal: updated, commissionIds: links.map((link) => link.commission_id), orderIds: links.map((link) => link.commission.order_id), before: withdrawal, after: updated, admin_user_id: context.admin_user_id, extraPayload: { tax_record_id: taxRecord.id, client_request_id: clientRequestId, ...requested } });
            return { withdrawal: updated, tax_record: taxRecord, idempotent: false };
          });
          return ok(reviewed);
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode === 409) {
            const after = await currentIdempotency();
            if (after.previous) {
              if (!jsonValuesEqual(after.previous.snapshot, requested)) throw httpError("client_request_id 对应的税务复核内容不一致", 409);
              const currentWithdrawal = await prisma.withdrawal.findUnique({ where: { id } });
              return ok({ withdrawal: currentWithdrawal, tax_record: after.existing, idempotent: true });
            }
          }
          throw error;
        }
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "提现税务复核失败");
      }
    },
  );

  app.post(
    "/api/admin/withdrawals/:id/approve",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as ReviewBody;
        const approved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await requireWithdrawalDataScope(id, request);
          const before = await loadWithdrawalOrThrow(tx, id);
          if (before.status === "approved") return { withdrawal: before, idempotent: true };
          if (before.status !== "pending") throw httpError("当前提现申请不可审核通过", 409);
          const context = resolveAdminAccessContext(request)!;
          const claimed = await tx.withdrawal.updateMany({ where: { id, status: "pending" }, data: { status: "approved", admin_remark: body.reason ?? body.remark ?? "人工审核通过", reviewed_by_admin_id: context.admin_user_id, reviewed_at: new Date() } });
          if (claimed.count !== 1) throw httpError("提现状态已变化，请刷新后重试", 409);
          const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
          const links = await getWithdrawalLinks(id, tx);
          await writeAdminAuditLog(tx, request, { action: "withdrawal_approved", target_id: id, payload: { reason: body.reason ?? body.remark ?? null } });
          await logWithdrawalEvent(tx, { event_type: "withdrawal_approved", withdrawal: updated, commissionIds: links.map((link) => link.commission_id), orderIds: links.map((link) => link.commission.order_id), before, after: updated, admin_user_id: context.admin_user_id });
          return { withdrawal: updated, idempotent: false };
        });
        return ok(approved);
      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "审核提现申请失败");
      }
    },
  );

  app.post(
    "/api/admin/withdrawals/:id/mark-paid",
    { preHandler: requireAdminPermission("withdrawal.manage") },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const body = request.body as ReviewBody;
        const manualReference = String(body.manual_reference ?? "").trim();
        if (!manualReference) throw new Error("人工处理参考号必填");
        const paid = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await requireWithdrawalDataScope(id, request);
          const before = await loadWithdrawalOrThrow(tx, id);
          if (before.status === "paid") return { withdrawal: before, idempotent: true };
          if (before.status !== "approved") throw httpError("仅审核通过的提现申请可标记已处理", 409);
          if (before.tax_status !== "completed" && before.tax_status !== "calculated") throw httpError("提现税务状态未完成或未计算，不能标记已处理", 409);
          if (before.payable_amount_cents < 0) throw httpError("可处理金额不能小于 0", 409);
          if (before.invoice_required && before.invoice_status !== "verified") throw httpError("发票状态未确认，不能标记已处理", 409);
          const context = resolveAdminAccessContext(request)!;
          const claimed = await tx.withdrawal.updateMany({ where: { id, status: "approved" }, data: { status: "paid", admin_remark: body.reason ?? body.remark ?? before.admin_remark, manual_reference: manualReference, processed_by_admin_id: context.admin_user_id, processed_at: new Date() } });
          if (claimed.count !== 1) throw httpError("提现状态已变化，请刷新后重试", 409);
          const updated = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
          const links = await getWithdrawalLinks(id, tx);
          const marked = await tx.commission.updateMany({ where: { id: { in: links.map((link) => link.commission_id) }, withdrawal_id: id, status: "withdrawing" }, data: { status: "withdrawn" } });
          if (marked.count !== links.length) throw httpError("提现关联奖励状态已变化，请人工复核", 409);
          await appendRewardLedgerEntry(tx, { leader_user_id: before.leader_user_id, withdrawal_id: id, event_type: "withdrawal_paid", entry_type: "withdrawal_paid", direction: "out", amount_cents: before.amount_cents, affects_available_balance: false, idempotency_key: `withdrawal-paid:${id}` });
          await writeAdminAuditLog(tx, request, { action: "withdrawal_mark_paid", target_id: id, payload: { manual_reference: manualReference, tax_status: updated.tax_status, payable_amount_cents: updated.payable_amount_cents } });
          await logWithdrawalEvent(tx, { event_type: "withdrawal_mark_paid", withdrawal: updated, commissionIds: links.map((link) => link.commission_id), orderIds: links.map((link) => link.commission.order_id), before, after: updated, admin_user_id: context.admin_user_id });
          return { withdrawal: updated, idempotent: false };
        });
        return ok(paid);
      } catch (error) {
        const restored = restoreMarkPaidTransactionError(error);
        reply.code(restored.statusCode);
        return fail(restored.message);
      }
    },
  );}

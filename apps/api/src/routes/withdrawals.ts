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
  tax_amount_cents?: number;
  tax_rate_basis?: string;
  invoice_required?: boolean;
  invoice_status?: string;
  tax_remark?: string;
};
type TaxRecordQuery = {
  leader_user_id?: string;
  source_type?: string;
  source_id?: string;
  tax_status?: string;
  from?: string;
  to?: string;
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

function resolveTaxStatus(body: TaxReviewBody) {
  if (body.tax_mode === "withheld") return "calculated";
  if (body.tax_mode === "none") return "completed";
  return body.invoice_status === "verified" ? "completed" : "pending_invoice";
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

export function registerWithdrawalRoutes(app: FastifyInstance) {
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
        const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 20) || 20));
        const context = resolveAdminAccessContext(request)!;
        const where: Prisma.WithdrawalWhereInput = {
          ...(query.status ? { status: query.status as any } : {}),
          ...(query.leader_user_id ? { leader_user_id: query.leader_user_id } : {}),
          ...(query.client_request_id ? { client_request_id: query.client_request_id } : {}),
          ...parseDateRange(query)
        };
        const candidates = await prisma.withdrawal.findMany({ where, include: { leader_user: true, commission_links: { include: { commission: { include: { order: { include: { product: true, community: true } } } } } } }, orderBy: { created_at: "desc" }, take: 500 });
        const keyword = String(query.keyword ?? "").trim().toLowerCase();
        const scoped = candidates.filter((w) => {
          const links = w.commission_links as unknown as WithdrawalLinkWithOrder[];
          if (!linksInScope(links, context)) return false;
          if (!keyword) return true;
          return w.leader_user_id.toLowerCase().includes(keyword) || (w.client_request_id ?? "").toLowerCase().includes(keyword) || (w.leader_user?.nickname ?? "").toLowerCase().includes(keyword);
        });
        const total = scoped.length;
        const items = scoped.slice((page - 1) * pageSize, page * pageSize).map((w) => adminWithdrawalDto(w, w.commission_links as unknown as WithdrawalLinkWithOrder[]));
        return ok({ items, total, page, page_size: pageSize });
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
    async (request) => {
      const query = request.query as TaxRecordQuery;
      const records = await prisma.taxRecord.findMany({
        where: {
          ...(query.leader_user_id
            ? { leader_user_id: query.leader_user_id }
            : {}),
          ...(query.source_type ? { source_type: query.source_type } : {}),
          ...(query.source_id ? { source_id: query.source_id } : {}),
          ...(query.tax_status ? { tax_status: query.tax_status } : {}),
          ...parseDateRange(query),
        },
        orderBy: { created_at: "desc" },
        take: 200,
      });
      return ok(records);
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
        const reviewed = await prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            await requireWithdrawalDataScope(id, request);
            const withdrawal = await tx.withdrawal.findUnique({
              where: { id },
            });
            if (!withdrawal) throw new Error("提现申请不存在");
            if (
              withdrawal.status !== "pending" &&
              withdrawal.status !== "approved"
            )
              throw new Error("当前提现申请不可做税务复核");
            if (
              body.tax_mode !== "none" &&
              body.tax_mode !== "withheld" &&
              body.tax_mode !== "invoice"
            )
              throw new Error("税务处理方式不合法");
            const taxMode = body.tax_mode;
            const taxAmount = Number(body.tax_amount_cents ?? 0);
            if (!Number.isInteger(taxAmount) || taxAmount < 0)
              throw new Error("税务金额不能小于 0");
            if (taxAmount > withdrawal.amount_cents)
              throw new Error("税务金额不能超过提现金额");
            const invoiceRequired =
              taxMode === "invoice" ? true : (body.invoice_required ?? false);
            const invoiceStatus =
              taxMode === "invoice"
                ? body.invoice_status && body.invoice_status !== "not_required"
                  ? body.invoice_status
                  : "pending"
                : (body.invoice_status ?? "not_required");
            const taxStatus = resolveTaxStatus({
              ...body,
              tax_mode: taxMode,
              invoice_status: invoiceStatus,
            });
            const updated = await tx.withdrawal.update({
              where: { id },
              data: {
                tax_mode: taxMode,
                tax_status: taxStatus,
                taxable_amount_cents: withdrawal.amount_cents,
                tax_amount_cents: taxAmount,
                payable_amount_cents: withdrawal.amount_cents - taxAmount,
                tax_rate_basis: body.tax_rate_basis ?? null,
                invoice_required: invoiceRequired,
                invoice_status: invoiceStatus,
                tax_remark: body.tax_remark ?? null,
              },
            });
            const taxRecord = await tx.taxRecord.upsert({
              where: {
                source_type_source_id: {
                  source_type: "withdrawal",
                  source_id: withdrawal.id,
                },
              },
              update: {
                leader_user_id: withdrawal.leader_user_id,
                tax_mode: taxMode,
                tax_status: taxStatus,
                amount_cents: withdrawal.amount_cents,
                payload: {
                  taxable_amount_cents: withdrawal.amount_cents,
                  tax_amount_cents: taxAmount,
                  payable_amount_cents: withdrawal.amount_cents - taxAmount,
                  tax_rate_basis: body.tax_rate_basis ?? null,
                  invoice_required: invoiceRequired,
                  invoice_status: invoiceStatus,
                  tax_remark: body.tax_remark ?? null,
                },
              },
              create: {
                leader_user_id: withdrawal.leader_user_id,
                source_type: "withdrawal",
                source_id: withdrawal.id,
                tax_mode: taxMode,
                tax_status: taxStatus,
                amount_cents: withdrawal.amount_cents,
                payload: {
                  taxable_amount_cents: withdrawal.amount_cents,
                  tax_amount_cents: taxAmount,
                  payable_amount_cents: withdrawal.amount_cents - taxAmount,
                  tax_rate_basis: body.tax_rate_basis ?? null,
                  invoice_required: invoiceRequired,
                  invoice_status: invoiceStatus,
                  tax_remark: body.tax_remark ?? null,
                },
              },
            });
            const links = await getWithdrawalLinks(id, tx);
            await writeAdminAuditLog(tx, request, {
              action: "withdrawal_tax_reviewed",
              target_id: id,
              payload: {
                tax_mode: taxMode,
                tax_status: taxStatus,
                tax_amount_cents: taxAmount,
              },
            });
            await logWithdrawalEvent(tx, {
              event_type: "withdrawal_tax_reviewed",
              withdrawal: updated,
              commissionIds: links.map((link) => link.commission_id),
              orderIds: links.map((link) => link.commission.order_id),
              before: withdrawal,
              after: updated,
              admin_user_id: resolveAdminAccessContext(request as any)?.admin_user_id ?? request.adminUser?.id ?? null,
              extraPayload: {
                tax_record_id: taxRecord.id,
                tax_mode: taxMode,
                tax_status: taxStatus,
                tax_amount_cents: taxAmount,
                payable_amount_cents: withdrawal.amount_cents - taxAmount,
                invoice_required: invoiceRequired,
                invoice_status: invoiceStatus,
              },
            });
            return { withdrawal: updated, tax_record: taxRecord };
          },
        );
        return ok(reviewed);
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
          if (before.tax_status === "pending") throw new Error("提现税务状态待复核，不能标记已处理");
          if (before.payable_amount_cents < 0) throw new Error("可处理金额不能小于 0");
          if (before.invoice_required && before.invoice_status !== "verified") throw new Error("发票状态未确认，不能标记已处理");
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
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "标记提现处理失败");
      }
    },
  );}

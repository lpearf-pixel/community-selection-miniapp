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
async function requireWithdrawalDataScope(withdrawalId: string, request: any) {
  const context = resolveAdminAccessContext(request);
  if (!context)
    throw Object.assign(
      new Error("ADMIN_UNAUTHORIZED: Admin identity required"),
      { statusCode: 401 },
    );
  if (context.is_super_admin) return context;
  const commissions = await prisma.commission.findMany({
    where: { withdrawal_id: withdrawalId },
    include: { order: true },
  });
  if (
    !commissions.length ||
    !commissions.every((item) => canAccessOrderDataScope(context, item.order))
  )
    throw Object.assign(new Error(ADMIN_SCOPE_FORBIDDEN), { statusCode: 403 });
  return context;
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
      const counts = await prisma.commission.groupBy({
        by: ["withdrawal_id"],
        where: { withdrawal_id: { in: withdrawals.map((w) => w.id) } },
        _count: { _all: true },
      });
      const countMap = new Map(
        counts.map((c) => [c.withdrawal_id, c._count._all]),
      );
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
      const count = await prisma.commission.count({
        where: { withdrawal_id: id },
      });
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
      if (!clientRequestId || clientRequestId.length > 80)
        throw new Error("client_request_id 必填且长度不能超过 80");
      const existing = await prisma.withdrawal.findUnique({
        where: { client_request_id: clientRequestId },
      });
      if (existing) {
        if (existing.leader_user_id !== leader.id)
          throw Object.assign(new Error("client_request_id 已被使用"), {
            statusCode: 409,
          });
        return ok({
          ...leaderWithdrawalDto(existing),
          applied: false,
          idempotent: true,
        });
      }
      const ids = Array.from(
        new Set((body.commission_ids ?? []).map(String).filter(Boolean)),
      );
      if (ids.length === 0) throw new Error("commission_ids 至少选择一条");
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
          });
          if (selected.length !== ids.length)
            throw new Error("存在不可提现或已占用的开团服务奖励");
          const amount = selected.reduce(
            (sum, item) => sum + item.final_amount_cents,
            0,
          );
          if (
            body.amount_cents !== undefined &&
            parseAmount(body.amount_cents) !== amount
          )
            throw new Error("提现金额必须精确匹配整笔开团服务奖励合计");
          const availableBalance = await getAvailableRewardBalance(
            tx,
            leader.id,
          );
          if (availableBalance < amount) {
            await safeRecordBusinessEvent(tx, {
              event_type: "withdrawal_ledger_mismatch",
              event_level: "warning",
              event_source: "withdrawals-route",
              leader_user_id: leader.id,
              payload: {
                available_balance_cents: availableBalance,
                requested_amount_cents: amount,
              },
            });
            throw new Error("奖励账本待人工复核");
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
          if (claimed.count !== ids.length)
            throw new Error("开团服务奖励已被其他提现申请占用");
          await appendRewardLedgerEntry(tx, {
            leader_user_id: leader.id,
            withdrawal_id: created.id,
            event_type: "withdrawal_reserved",
            entry_type: "withdrawal_reserved",
            direction: "out",
            amount_cents: amount,
            affects_available_balance: true,
            idempotency_key: `withdrawal-reserved:${created.id}`,
          });
          await logWithdrawalEvent(tx, {
            event_type: "withdrawal_requested",
            withdrawal: created,
            commissionIds: ids,
            orderIds: selected.map((i) => i.order_id),
            after: created,
          });
          return created;
        },
      );
      return ok({
        ...leaderWithdrawalDto(result, ids.length),
        applied: true,
        idempotent: false,
      });
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 400);
      return fail(error instanceof Error ? error.message : "提交提现申请失败");
    }
  });

  app.get(
    "/api/admin/withdrawals",
    { preHandler: requireAdminPermission("withdrawal.view") },
    async () => {
      const withdrawals = await prisma.withdrawal.findMany({
        orderBy: { created_at: "desc" },
        include: { leader_user: true },
      });
      const counts = await prisma.commission.groupBy({
        by: ["withdrawal_id"],
        where: { withdrawal_id: { in: withdrawals.map((w) => w.id) } },
        _count: { _all: true },
      });
      const countMap = new Map(
        counts.map((c) => [c.withdrawal_id, c._count._all]),
      );
      return ok(
        withdrawals.map((w) => ({
          withdrawal_id: w.id,
          client_request_id: w.client_request_id,
          leader_user_id: w.leader_user_id,
          leader_nickname: w.leader_user.nickname,
          leader_phone_masked: maskPhone(w.leader_user.phone),
          amount_cents: w.amount_cents,
          status: w.status,
          commission_count: countMap.get(w.id) ?? 0,
          community_names: [],
          created_at: w.created_at,
          reviewed_at: w.reviewed_at,
          processed_at: w.processed_at,
          admin_remark: w.admin_remark,
        })),
      );
    },
  );

  app.get(
    "/api/admin/tax-records",
    { preHandler: requireAdminPermission("withdrawal.view") },
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
        const rejected = await prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            await requireWithdrawalDataScope(id, request);
            const withdrawal = await tx.withdrawal.findUnique({
              where: { id },
            });
            if (!withdrawal) throw new Error("提现申请不存在");
            if (withdrawal.status !== "pending")
              throw new Error("当前提现申请不可拒绝");
            const commissions = await tx.commission.findMany({
              where: { withdrawal_id: id },
            });
            const reason = String(body.reason ?? body.remark ?? "").trim();
            if (!reason) throw new Error("拒绝原因必填");
            const updated = await tx.withdrawal.update({
              where: { id },
              data: {
                status: "rejected",
                admin_remark: reason.slice(0, 200),
                rejected_at: new Date(),
                reviewed_by_admin_id:
                  resolveAdminAccessContext(request)?.admin_user_id ?? null,
                reviewed_at: new Date(),
              },
            });
            await tx.commission.updateMany({
              where: { withdrawal_id: id },
              data: { status: "available", withdrawal_id: null },
            });
            await appendRewardLedgerEntry(tx, {
              leader_user_id: withdrawal.leader_user_id,
              withdrawal_id: id,
              event_type: "withdrawal_rejected_restore",
              entry_type: "withdrawal_rejected_restore",
              direction: "in",
              amount_cents: withdrawal.amount_cents,
              affects_available_balance: true,
              idempotency_key: `withdrawal-rejected-restore:${id}`,
            });
            await writeAdminAuditLog(tx, request, {
              action: "withdrawal_rejected",
              target_id: id,
              payload: { reason: body.reason ?? null },
            });
            await logWithdrawalEvent(tx, {
              event_type: "withdrawal_rejected",
              withdrawal: updated,
              commissionIds: commissions.map((item) => item.id),
              orderIds: commissions.map((item) => item.order_id),
              before: withdrawal,
              after: updated,
              admin_user_id: resolveAdminAccessContext(request as any)?.admin_user_id ?? request.adminUser?.id ?? null,
            });
            return updated;
          },
        );
        return ok(rejected);
      } catch (error) {
        reply.code(400);
        return fail(
          error instanceof Error ? error.message : "拒绝提现申请失败",
        );
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
            const commissions = await tx.commission.findMany({
              where: { withdrawal_id: id },
            });
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
              commissionIds: commissions.map((item) => item.id),
              orderIds: commissions.map((item) => item.order_id),
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
        reply.code(400);
        return fail(
          error instanceof Error ? error.message : "提现税务复核失败",
        );
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
        const approved = await prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            await requireWithdrawalDataScope(id, request);
            const withdrawal = await tx.withdrawal.findUnique({
              where: { id },
            });
            if (!withdrawal) throw new Error("提现申请不存在");
            if (withdrawal.status !== "pending")
              throw new Error("当前提现申请不可审核通过");
            const commissions = await tx.commission.findMany({
              where: { withdrawal_id: id },
            });
            const updated = await tx.withdrawal.update({
              where: { id },
              data: {
                status: "approved",
                admin_remark: body.reason ?? body.remark ?? "人工审核通过",
                reviewed_by_admin_id:
                  resolveAdminAccessContext(request)?.admin_user_id ?? null,
                reviewed_at: new Date(),
              },
            });
            await writeAdminAuditLog(tx, request, {
              action: "withdrawal_approved",
              target_id: id,
              payload: { reason: body.reason ?? null },
            });
            await logWithdrawalEvent(tx, {
              event_type: "withdrawal_approved",
              withdrawal: updated,
              commissionIds: commissions.map((item) => item.id),
              orderIds: commissions.map((item) => item.order_id),
              before: withdrawal,
              after: updated,
              admin_user_id: resolveAdminAccessContext(request as any)?.admin_user_id ?? request.adminUser?.id ?? null,
            });
            return updated;
          },
        );
        return ok(approved);
      } catch (error) {
        reply.code(400);
        return fail(
          error instanceof Error ? error.message : "审核提现申请失败",
        );
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
        const paid = await prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            await requireWithdrawalDataScope(id, request);
            const withdrawal = await tx.withdrawal.findUnique({
              where: { id },
            });
            if (!withdrawal) throw new Error("提现申请不存在");
            if (withdrawal.status !== "approved")
              throw new Error("仅审核通过的提现申请可标记已处理");
            if (withdrawal.tax_status === "pending")
              throw new Error("提现税务状态待复核，不能标记已处理");
            if (withdrawal.payable_amount_cents < 0)
              throw new Error("可处理金额不能小于 0");
            if (
              withdrawal.invoice_required &&
              withdrawal.invoice_status !== "verified"
            )
              throw new Error("发票状态未确认，不能标记已处理");
            const commissions = await tx.commission.findMany({
              where: { withdrawal_id: id },
            });
            const manualReference = String(body.manual_reference ?? "").trim();
            if (!manualReference) throw new Error("人工处理参考号必填");
            const updated = await tx.withdrawal.update({
              where: { id },
              data: {
                status: "paid",
                admin_remark:
                  body.reason ?? body.remark ?? withdrawal.admin_remark,
                manual_reference: manualReference,
                processed_by_admin_id:
                  resolveAdminAccessContext(request)?.admin_user_id ?? null,
                processed_at: new Date(),
              },
            });
            await tx.commission.updateMany({
              where: { withdrawal_id: id },
              data: { status: "withdrawn" },
            });
            await appendRewardLedgerEntry(tx, {
              leader_user_id: withdrawal.leader_user_id,
              withdrawal_id: id,
              event_type: "withdrawal_paid",
              entry_type: "withdrawal_paid",
              direction: "out",
              amount_cents: withdrawal.amount_cents,
              affects_available_balance: false,
              idempotency_key: `withdrawal-paid:${id}`,
            });
            await writeAdminAuditLog(tx, request, {
              action: "withdrawal_mark_paid",
              target_id: id,
              payload: {
                tax_status: updated.tax_status,
                payable_amount_cents: updated.payable_amount_cents,
              },
            });
            await logWithdrawalEvent(tx, {
              event_type: "withdrawal_mark_paid",
              withdrawal: updated,
              commissionIds: commissions.map((item) => item.id),
              orderIds: commissions.map((item) => item.order_id),
              before: withdrawal,
              after: updated,
              admin_user_id: resolveAdminAccessContext(request as any)?.admin_user_id ?? request.adminUser?.id ?? null,
            });
            return updated;
          },
        );
        return ok(paid);
      } catch (error) {
        reply.code(400);
        return fail(
          error instanceof Error ? error.message : "标记提现处理失败",
        );
      }
    },
  );
}

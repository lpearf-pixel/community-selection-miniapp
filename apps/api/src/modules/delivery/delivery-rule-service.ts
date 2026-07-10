import { prisma } from '../../db.js';

export type DeliveryTimeWindow = { code: string; label: string; start_time: string; end_time: string };
export type DeliveryRule = {
  enabled: boolean;
  delivery_mode: 'store_delivery';
  base_fee_cents: number;
  free_threshold_cents: number | null;
  max_distance_km: number | null;
  service_radius_text: string;
  available_time_windows: DeliveryTimeWindow[];
  notice: string;
  source?: 'pickup_store' | 'global_default' | 'fallback';
};
export type DeliveryRuleConfigDto = DeliveryRule & { id: string; pickup_store_id: string | null; updated_at: Date; created_at: Date };

const staticRule: DeliveryRule = {
  enabled: true,
  delivery_mode: 'store_delivery',
  base_fee_cents: 0,
  free_threshold_cents: null,
  max_distance_km: null,
  service_radius_text: '门店周边 3-5km，具体以门店确认为准',
  available_time_windows: [
    { code: 'today_afternoon', label: '今日下午', start_time: '14:00', end_time: '18:00' },
    { code: 'today_evening', label: '今日晚上', start_time: '18:00', end_time: '21:00' },
    { code: 'tomorrow_morning', label: '明日上午', start_time: '09:00', end_time: '12:00' }
  ],
  notice: '当前为门店配送，暂不接第三方配送。配送范围与时段以门店确认为准。',
  source: 'fallback'
};

function cloneRule(rule: DeliveryRule): DeliveryRule { return { ...rule, available_time_windows: rule.available_time_windows.map((item) => ({ ...item })) }; }
function hhmm(value: string) { return /^\d{2}:\d{2}$/.test(value); }
export function validateTimeWindows(value: unknown): DeliveryTimeWindow[] {
  if (!Array.isArray(value)) throw new Error('available_time_windows 必须是数组');
  const seen = new Set<string>();
  return value.map((item) => {
    const row = item as Partial<DeliveryTimeWindow>;
    if (!row.code?.trim() || !row.label?.trim() || !row.start_time?.trim() || !row.end_time?.trim()) throw new Error('配送时段需包含 code/label/start_time/end_time');
    if (!hhmm(row.start_time) || !hhmm(row.end_time)) throw new Error('配送时段时间格式必须为 HH:mm');
    if (seen.has(row.code)) throw new Error('配送时段 code 唯一');
    seen.add(row.code);
    return { code: row.code, label: row.label, start_time: row.start_time, end_time: row.end_time };
  });
}
function validateConfig(input: any) {
  if (!Number.isInteger(input.base_fee_cents) || input.base_fee_cents < 0) throw new Error('base_fee_cents 必须大于等于 0');
  if (input.free_threshold_cents != null && (!Number.isInteger(input.free_threshold_cents) || input.free_threshold_cents < 0)) throw new Error('free_threshold_cents 必须大于等于 0');
  if (input.max_distance_km != null && Number(input.max_distance_km) < 0) throw new Error('max_distance_km 必须大于等于 0');
  if (!String(input.service_radius_text ?? '').trim()) throw new Error('service_radius_text 必填');
  if (!String(input.notice ?? '').trim()) throw new Error('notice 必填');
  return validateTimeWindows(input.available_time_windows);
}
function mapConfig(row: any, source?: DeliveryRule['source']): DeliveryRuleConfigDto {
  const available_time_windows = validateTimeWindows(row.time_windows_json);
  return { id: row.id, pickup_store_id: row.pickup_store_id ?? null, enabled: row.enabled, delivery_mode: 'store_delivery', base_fee_cents: row.base_fee_cents, free_threshold_cents: row.free_threshold_cents ?? null, max_distance_km: row.max_distance_km == null ? null : Number(row.max_distance_km), service_radius_text: row.service_radius_text, available_time_windows, notice: row.notice, source, created_at: row.created_at, updated_at: row.updated_at };
}

export async function getDeliveryRule(input?: { pickup_store_id?: string | null }): Promise<DeliveryRule> {
  const pickup_store_id = input?.pickup_store_id?.trim() || null;
  const model = (prisma as any).deliveryRuleConfig;
  try {
    if (pickup_store_id) {
      const pickupRule = await model.findFirst({ where: { pickup_store_id }, orderBy: { updated_at: 'desc' } });
      if (pickupRule) return mapConfig(pickupRule, 'pickup_store');
    }
    const globalRule = await model.findFirst({ where: { pickup_store_id: null }, orderBy: { updated_at: 'desc' } });
    if (globalRule) return mapConfig(globalRule, 'global_default');
  } catch {
    return cloneRule(staticRule);
  }
  return cloneRule(staticRule);
}

export async function validateDeliveryRuleForOrder(input: { delivery_time_window_code?: string | null; receiver_address?: string | null; receiver_name?: string | null; receiver_phone?: string | null; pickup_store_id?: string | null; order_amount_cents?: number | null }) {
  const rule = await getDeliveryRule({ pickup_store_id: input.pickup_store_id });
  if (!rule.enabled) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '该自提点暂不支持门店配送' };
  if (!input.pickup_store_id?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要选择发货点' };
  if (!input.receiver_name?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要收货人' };
  if (!input.receiver_phone?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要手机号' };
  if (!input.receiver_address?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '配送地址必填校验：请填写收货地址' };
  const delivery_time_window = rule.available_time_windows.find((item) => item.code === input.delivery_time_window_code) ?? null;
  if (!delivery_time_window) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '配送时段必填校验：请选择配送时段' };
  const orderAmount = Number(input.order_amount_cents ?? 0);
  const delivery_fee_cents = rule.free_threshold_cents != null && orderAmount >= rule.free_threshold_cents ? 0 : rule.base_fee_cents;
  // 不计算距离，不请求用户定位，不调用第三方配送 API，不调用达达，不创建第三方配送单。
  return { ok: true, delivery_fee_cents, delivery_time_window, error_message: undefined };
}

export async function listDeliveryRuleConfigs(query?: { pickup_store_id?: string | null }) {
  const where = query?.pickup_store_id ? { pickup_store_id: query.pickup_store_id } : {};
  const rows = await (prisma as any).deliveryRuleConfig.findMany({ where, orderBy: [{ pickup_store_id: 'asc' }, { updated_at: 'desc' }] });
  return { items: rows.map((row: any) => mapConfig(row, row.pickup_store_id ? 'pickup_store' : 'global_default')) };
}
export async function getDeliveryRuleConfig(id: string) { const row = await (prisma as any).deliveryRuleConfig.findUnique({ where: { id } }); if (!row) throw new Error('配送规则配置不存在'); return mapConfig(row, row.pickup_store_id ? 'pickup_store' : 'global_default'); }
export async function upsertDeliveryRuleConfig(input: any) {
  const available_time_windows = validateConfig(input);
  const data = { pickup_store_id: input.pickup_store_id?.trim() || null, enabled: Boolean(input.enabled), base_fee_cents: input.base_fee_cents, free_threshold_cents: input.free_threshold_cents ?? null, max_distance_km: input.max_distance_km ?? null, service_radius_text: input.service_radius_text.trim(), notice: input.notice.trim(), time_windows_json: available_time_windows };
  const row = input.id ? await (prisma as any).deliveryRuleConfig.update({ where: { id: input.id }, data }) : await (prisma as any).deliveryRuleConfig.create({ data });
  return mapConfig(row, row.pickup_store_id ? 'pickup_store' : 'global_default');
}
export async function disableDeliveryRuleConfig(id: string) { const row = await (prisma as any).deliveryRuleConfig.update({ where: { id }, data: { enabled: false } }); return mapConfig(row, row.pickup_store_id ? 'pickup_store' : 'global_default'); }
export function deliveryTimeWindowText(window: DeliveryTimeWindow | null) { return window ? `${window.label} ${window.start_time}-${window.end_time}` : '以门店确认时段为准'; }

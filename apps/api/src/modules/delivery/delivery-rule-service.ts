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
};

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
  notice: '当前为门店配送，暂不接第三方配送。配送范围与时段以门店确认为准。'
};

export function getDeliveryRule(): DeliveryRule {
  return { ...staticRule, available_time_windows: staticRule.available_time_windows.map((item) => ({ ...item })) };
}

export function validateDeliveryRuleForOrder(input: { delivery_time_window_code?: string | null; receiver_address?: string | null; receiver_name?: string | null; receiver_phone?: string | null; pickup_store_id?: string | null }) {
  const rule = getDeliveryRule();
  if (!rule.enabled) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送暂不可用' };
  if (!input.pickup_store_id?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要选择发货点' };
  if (!input.receiver_name?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要收货人' };
  if (!input.receiver_phone?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '门店配送需要手机号' };
  if (!input.receiver_address?.trim()) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '配送地址必填校验：请填写收货地址' };
  const delivery_time_window = rule.available_time_windows.find((item) => item.code === input.delivery_time_window_code) ?? null;
  if (!delivery_time_window) return { ok: false, delivery_fee_cents: 0, delivery_time_window: null, error_message: '配送时段必填校验：请选择配送时段' };
  // 不计算距离，不请求用户定位，不调用第三方配送 API，不调用达达，不创建第三方配送单。
  return { ok: true, delivery_fee_cents: rule.base_fee_cents, delivery_time_window, error_message: undefined };
}

export function deliveryTimeWindowText(window: DeliveryTimeWindow | null) {
  return window ? `${window.label} ${window.start_time}-${window.end_time}` : '以门店确认时段为准';
}

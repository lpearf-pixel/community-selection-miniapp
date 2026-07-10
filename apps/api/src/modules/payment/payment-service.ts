// L38 mock payment baseline: payment amount is sourced from Order.pay_amount_cents,
// which includes delivery_fee_cents for pickup_type=delivery. 不接真实支付。
export { markOrderPaid } from '../../services/payment-service.js';

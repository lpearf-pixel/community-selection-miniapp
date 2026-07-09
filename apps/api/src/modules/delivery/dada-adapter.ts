import type { DeliveryMode } from './delivery-types.js';

export type DadaCreateOrderInput = {
  order_id: string;
  order_no: string;
  delivery_mode: DeliveryMode;
  sender_address: string | null;
  receiver_address_masked: string | null;
};

export type DadaCreateOrderResult = {
  provider: 'dada';
  mode: 'mock';
  third_party_order_no: null;
  status: 'reserved';
  message: string;
};

export async function createDadaDeliveryOrderMock(input: DadaCreateOrderInput): Promise<DadaCreateOrderResult> {
  void input;
  return { provider: 'dada', mode: 'mock', third_party_order_no: null, status: 'reserved', message: 'Dada delivery API is reserved but not enabled' };
}

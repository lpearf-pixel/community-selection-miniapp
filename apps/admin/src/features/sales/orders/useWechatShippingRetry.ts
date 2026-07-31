import { useState } from 'react';
import {
  loadOrderAiContext,
  retryWechatShipping,
} from './api';
import type { AiContext } from './types';

export function useWechatShippingRetry(input: {
  context: AiContext | null;
  setContext: (context: AiContext) => void;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    if (!input.context || retrying) return;
    setRetrying(true);
    try {
      await retryWechatShipping(input.context.order.id);
      input.setContext(
        await loadOrderAiContext(input.context.order.id),
      );
      input.onMessage('已重新加入微信发货同步队列');
      input.onMutationCommitted();
    } finally {
      setRetrying(false);
    }
  };

  return { retrying, retry };
}

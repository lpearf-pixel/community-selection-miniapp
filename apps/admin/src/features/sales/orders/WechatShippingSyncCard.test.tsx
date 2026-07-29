import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WechatShippingSyncCard } from './WechatShippingSyncCard';

describe('WeChat shipping sync card', () => {
  it('shows a retry action only for actionable failures', () => {
    const retryable = renderToStaticMarkup(
      <WechatShippingSyncCard
        summary={{
          status: 'retryable',
          attempts: 2,
          last_error_code: 'WECHAT_SHIPPING_HTTP_503',
          next_retry_at: '2026-07-29T12:02:00.000Z',
          succeeded_at: null,
        }}
        retrying={false}
        onRetry={() => undefined}
      />,
    );
    expect(retryable).toContain('等待重试');
    expect(retryable).toContain('重新加入同步队列');

    const succeeded = renderToStaticMarkup(
      <WechatShippingSyncCard
        summary={{
          status: 'succeeded',
          attempts: 1,
          last_error_code: null,
          next_retry_at: null,
          succeeded_at: '2026-07-29T12:00:00.000Z',
        }}
        retrying={false}
        onRetry={() => undefined}
      />,
    );
    expect(succeeded).toContain('已同步');
    expect(succeeded).not.toContain('重新加入同步队列');
  });
});

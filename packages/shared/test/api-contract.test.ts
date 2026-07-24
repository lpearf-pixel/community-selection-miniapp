import { describe, expect, it } from 'vitest';
import {
  buildPaginationMetadata,
  contractFail,
  contractOk,
} from '../src/index.js';

describe('V1 API contract', () => {
  it('builds traceable success and error envelopes', () => {
    expect(
      contractOk(
        { id: 'o1' },
        {
          code: 'ORDER_FOUND',
          message: 'ok',
          traceId: 'trace-1',
        },
      ),
    ).toEqual({
      success: true,
      data: { id: 'o1' },
      code: 'ORDER_FOUND',
      message: 'ok',
      trace_id: 'trace-1',
    });
    expect(
      contractFail({
        code: 'ORDER_NOT_FOUND',
        message: 'missing',
        traceId: 'trace-2',
      }),
    ).toEqual({
      success: false,
      data: null,
      code: 'ORDER_NOT_FOUND',
      message: 'missing',
      trace_id: 'trace-2',
    });
  });

  it('builds empty and non-empty pagination metadata', () => {
    expect(
      buildPaginationMetadata({ page: 1, pageSize: 20, total: 0 }),
    ).toEqual({
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
      has_previous: false,
      has_next: false,
    });
    expect(
      buildPaginationMetadata({ page: 2, pageSize: 20, total: 45 }),
    ).toEqual({
      page: 2,
      page_size: 20,
      total: 45,
      total_pages: 3,
      has_previous: true,
      has_next: true,
    });
  });
});

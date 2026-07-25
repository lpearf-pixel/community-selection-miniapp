import { describe, expect, it } from 'vitest';
import { assertLegacyAfterSaleResolutionAllowed } from './after-sale-service.js';

describe('legacy after-sale resolution boundary', () => {
  it.each(['refund', 'partial_refund'])(
    'requires the reliable refund command for %s',
    (resolutionType) => {
      expect(() =>
        assertLegacyAfterSaleResolutionAllowed(resolutionType),
      ).toThrowError('退款类售后请使用可靠退款执行命令');
    },
  );

  it.each(['reship', 'compensation', 'reject'])(
    'preserves non-refund resolution %s',
    (resolutionType) => {
      expect(() =>
        assertLegacyAfterSaleResolutionAllowed(resolutionType),
      ).not.toThrow();
    },
  );
});

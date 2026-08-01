export type PricingChannel = 'regular' | 'group';
export type PriceSource = 'regular' | 'member' | 'group' | 'group_member';

export class MemberPricingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MemberPricingError';
  }
}

export type MemberPriceQuoteInput = {
  enabled: boolean;
  channel: PricingChannel;
  listPriceCents: number;
  channelPriceCents: number;
  costPriceCents: number;
  memberDiscountBps: number;
  groupMemberDiscountBps: number;
  minimumMarginBps: number;
  minimumMarginCents: number;
  ruleVersion: number;
  membership:
    | { active: true; accountId: string; periodId: string }
    | { active: false };
};

export type MemberPriceQuote = {
  channel: PricingChannel;
  priceSource: PriceSource;
  listPriceCents: number;
  channelPriceCents: number;
  candidatePriceCents: number;
  floorPriceCents: number;
  unitPriceCents: number;
  discountBps: number | null;
  marginFloorApplied: boolean;
  membershipAccountId: string | null;
  membershipPeriodId: string | null;
  ruleVersion: number;
};

function requireInteger(value: number, name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MemberPricingError('PRICING_RULE_INVALID', `${name} 配置无效`);
  }
}

export function quoteMemberPrice(input: MemberPriceQuoteInput): MemberPriceQuote {
  requireInteger(input.listPriceCents, '商品标价', 1);
  requireInteger(input.channelPriceCents, '渠道价格', 1);
  requireInteger(input.ruleVersion, '价格规则版本', 1);
  const baseSource: PriceSource = input.channel === 'group' ? 'group' : 'regular';
  if (!input.enabled || !input.membership.active) {
    return {
      channel: input.channel,
      priceSource: baseSource,
      listPriceCents: input.listPriceCents,
      channelPriceCents: input.channelPriceCents,
      candidatePriceCents: input.channelPriceCents,
      floorPriceCents: 0,
      unitPriceCents: input.channelPriceCents,
      discountBps: null,
      marginFloorApplied: false,
      membershipAccountId: null,
      membershipPeriodId: null,
      ruleVersion: input.ruleVersion,
    };
  }
  requireInteger(input.costPriceCents, '商品成本', 0);
  requireInteger(input.memberDiscountBps, '普通会员折扣', 1, 10_000);
  requireInteger(input.groupMemberDiscountBps, '团购会员折扣', 1, 10_000);
  requireInteger(input.minimumMarginBps, '最低毛利率', 0, 9_999);
  requireInteger(input.minimumMarginCents, '最低毛利额', 0);
  if (input.channelPriceCents > input.listPriceCents && input.channel === 'group') {
    throw new MemberPricingError('GROUP_PRICE_ABOVE_LIST', '团购价不得高于商品标价');
  }

  const floorByAmount = input.costPriceCents + input.minimumMarginCents;
  const floorByRate = Math.ceil(
    input.costPriceCents * 10_000 / (10_000 - input.minimumMarginBps),
  );
  const floorPriceCents = Math.max(floorByAmount, floorByRate);
  if (input.channelPriceCents < floorPriceCents) {
    throw new MemberPricingError(
      'MARGIN_FLOOR_UNSATISFIABLE',
      '当前渠道价格低于最低毛利保护线',
    );
  }

  const discountBps = input.channel === 'group'
    ? input.groupMemberDiscountBps
    : input.memberDiscountBps;
  const discountedListPrice = Math.floor(input.listPriceCents * discountBps / 10_000);
  const candidatePriceCents = Math.min(input.channelPriceCents, discountedListPrice);
  const unitPriceCents = Math.max(candidatePriceCents, floorPriceCents);
  const membershipImprovedPrice = unitPriceCents < input.channelPriceCents;
  const priceSource: PriceSource = membershipImprovedPrice
    ? (input.channel === 'group' ? 'group_member' : 'member')
    : baseSource;

  return {
    channel: input.channel,
    priceSource,
    listPriceCents: input.listPriceCents,
    channelPriceCents: input.channelPriceCents,
    candidatePriceCents,
    floorPriceCents,
    unitPriceCents,
    discountBps,
    marginFloorApplied: unitPriceCents > candidatePriceCents,
    membershipAccountId: input.membership.accountId,
    membershipPeriodId: input.membership.periodId,
    ruleVersion: input.ruleVersion,
  };
}

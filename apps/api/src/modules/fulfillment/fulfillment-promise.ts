import type { Prisma } from '@prisma/client';

const PROMISE_TIMEZONE = 'Asia/Shanghai';
const SHANGHAI_OFFSET = '+08:00';

type PromiseWindow = {
  code: string;
  label: string;
  start_time: string;
  end_time: string;
  day_offset?: number;
};

type DeliveryPromiseInput = {
  kind: 'delivery';
  capturedAt: Date;
  window: PromiseWindow;
  sourceRule?: {
    id: string;
    updated_at: Date;
  };
};

type GroupBuyPickupPromiseInput = {
  kind: 'group_buy_pickup';
  capturedAt: Date;
  pickupTime: Date;
};

type NormalPickupPromiseInput = {
  kind: 'normal_pickup';
  capturedAt: Date;
};

export type FulfillmentPromiseInput =
  | DeliveryPromiseInput
  | GroupBuyPickupPromiseInput
  | NormalPickupPromiseInput;

export type FulfillmentPromiseFields = {
  fulfillment_promise_snapshot: Prisma.InputJsonValue;
  promised_fulfillment_start_at: Date | null;
  promised_fulfillment_end_at: Date | null;
};

type ShanghaiDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function shanghaiParts(value: Date): ShanghaiDateParts {
  if (Number.isNaN(value.getTime())) {
    throw new Error('履约承诺时间不合法');
  }
  const values = new Map(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: PROMISE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get('year')!,
    month: values.get('month')!,
    day: values.get('day')!,
    hour: values.get('hour')!,
    minute: values.get('minute')!,
  };
}

function addCalendarDays(
  input: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>,
  dayOffset: number,
) {
  const value = new Date(
    Date.UTC(input.year, input.month - 1, input.day + dayOffset),
  );
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0');
}

function absoluteShanghaiTime(
  date: Pick<ShanghaiDateParts, 'year' | 'month' | 'day'>,
  time: string,
) {
  return new Date(
    `${date.year}-${twoDigits(date.month)}-${twoDigits(date.day)}T${time}:00${SHANGHAI_OFFSET}`,
  );
}

function resolvedDayOffset(window: PromiseWindow) {
  if (window.day_offset !== undefined) {
    if (
      !Number.isSafeInteger(window.day_offset) ||
      window.day_offset < 0 ||
      window.day_offset > 30
    ) {
      throw new Error('配送承诺时段 day_offset 不合法');
    }
    return window.day_offset;
  }
  return window.code.startsWith('tomorrow_') ? 1 : 0;
}

function validateWindow(window: PromiseWindow) {
  const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (
    !window.code.trim() ||
    !window.label.trim() ||
    !hhmm.test(window.start_time) ||
    !hhmm.test(window.end_time) ||
    window.end_time <= window.start_time
  ) {
    throw new Error('配送承诺时段不合法');
  }
}

function baseSnapshot(input: {
  fulfillmentType: 'store' | 'delivery';
  displayText: string;
  promisedStartAt: Date | null;
  promisedEndAt: Date | null;
  source:
    | 'delivery_rule'
    | 'group_buy_pickup'
    | 'store_confirmation_pending';
  capturedAt: Date;
  windowCode?: string | null;
}) {
  return {
    schema_version: 1,
    fulfillment_type: input.fulfillmentType,
    window_code: input.windowCode ?? null,
    display_text: input.displayText,
    promised_start_at: input.promisedStartAt?.toISOString() ?? null,
    promised_end_at: input.promisedEndAt?.toISOString() ?? null,
    timezone: PROMISE_TIMEZONE,
    source: input.source,
    captured_at: input.capturedAt.toISOString(),
  };
}

export function buildFulfillmentPromise(
  input: FulfillmentPromiseInput,
): FulfillmentPromiseFields {
  if (input.kind === 'delivery') {
    validateWindow(input.window);
    const date = addCalendarDays(
      shanghaiParts(input.capturedAt),
      resolvedDayOffset(input.window),
    );
    const promisedStartAt = absoluteShanghaiTime(
      date,
      input.window.start_time,
    );
    const promisedEndAt = absoluteShanghaiTime(date, input.window.end_time);
    return {
      fulfillment_promise_snapshot: {
        ...baseSnapshot({
          fulfillmentType: 'delivery',
          displayText: `${input.window.label} ${input.window.start_time}-${input.window.end_time}`,
          promisedStartAt,
          promisedEndAt,
          source: 'delivery_rule',
          capturedAt: input.capturedAt,
          windowCode: input.window.code,
        }),
        ...(input.sourceRule
          ? {
              source_rule_id: input.sourceRule.id,
              source_rule_updated_at:
                input.sourceRule.updated_at.toISOString(),
            }
          : {}),
      },
      promised_fulfillment_start_at: promisedStartAt,
      promised_fulfillment_end_at: promisedEndAt,
    };
  }

  if (input.kind === 'group_buy_pickup') {
    const pickup = shanghaiParts(input.pickupTime);
    const displayText = `${pickup.year}年${pickup.month}月${pickup.day}日 ${twoDigits(pickup.hour)}:${twoDigits(pickup.minute)} 自提`;
    return {
      fulfillment_promise_snapshot: baseSnapshot({
        fulfillmentType: 'store',
        displayText,
        promisedStartAt: input.pickupTime,
        promisedEndAt: null,
        source: 'group_buy_pickup',
        capturedAt: input.capturedAt,
      }),
      promised_fulfillment_start_at: input.pickupTime,
      promised_fulfillment_end_at: null,
    };
  }

  return {
    fulfillment_promise_snapshot: baseSnapshot({
      fulfillmentType: 'store',
      displayText: '门店确认后通知自提时间',
      promisedStartAt: null,
      promisedEndAt: null,
      source: 'store_confirmation_pending',
      capturedAt: input.capturedAt,
    }),
    promised_fulfillment_start_at: null,
    promised_fulfillment_end_at: null,
  };
}

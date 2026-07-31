import { describe, expect, it } from 'vitest';
import {
  FIRST_LAUNCH_CATEGORY_RULE_VERSION,
  decideFirstLaunchCategory,
} from './first-launch-category-rules.js';

describe('L53-D2 first-launch category policy', () => {
  it.each([
    'vegetable',
    'fruit',
    'egg',
    'grain',
    'primary_dried_goods',
  ])('allows the approved first-launch category %s', (code) => {
    expect(decideFirstLaunchCategory(code)).toEqual({
      allowed: true,
      reason: null,
      rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
    });
  });

  it.each([
    'prepackaged_food',
    'processed_food',
    'alcohol',
    'health_food',
    'medicine',
    'imported_cold_chain',
    'temporary',
  ])('fails closed for the non-first-launch category %s', (code) => {
    expect(decideFirstLaunchCategory(code)).toEqual({
      allowed: false,
      reason: 'CATEGORY_NOT_ALLOWED',
      rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
    });
  });

  it.each([null, undefined, '', '   '])(
    'fails closed when the compliance category code is %s',
    (code) => {
      expect(decideFirstLaunchCategory(code)).toEqual({
        allowed: false,
        reason: 'CATEGORY_CODE_MISSING',
        rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
      });
    },
  );

  it('normalizes surrounding whitespace without accepting case variants', () => {
    expect(decideFirstLaunchCategory(' vegetable ')).toMatchObject({
      allowed: true,
      reason: null,
    });
    expect(decideFirstLaunchCategory('VEGETABLE')).toMatchObject({
      allowed: false,
      reason: 'CATEGORY_NOT_ALLOWED',
    });
  });
});

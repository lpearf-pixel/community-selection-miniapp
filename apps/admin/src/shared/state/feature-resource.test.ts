import { describe, expect, it } from 'vitest';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from './feature-resource';

describe('feature resource state', () => {
  it('keeps prior data visible while a refresh starts', () => {
    const ready = reduceFeatureResource(
      initialFeatureResourceState<number>(),
      { type: 'resolved', data: 7 },
    );
    expect(reduceFeatureResource(ready, { type: 'started' })).toEqual({
      status: 'refreshing',
      data: 7,
      error: null,
    });
  });

  it('records a safe error without discarding prior data', () => {
    expect(
      reduceFeatureResource(
        { status: 'ready', data: 7, error: null },
        { type: 'rejected', message: '加载失败' },
      ),
    ).toEqual({
      status: 'error',
      data: 7,
      error: '加载失败',
    });
  });

  it('does not expose arbitrary object fields as an error message', () => {
    expect(featureErrorMessage({ token: 'secret' })).toBe('页面数据加载失败');
  });
});

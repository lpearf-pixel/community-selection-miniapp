import { AdminApiError } from '../api/errors';

export type FeatureResourceState<T> = {
  status: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  data: T | null;
  error: string | null;
};

export type FeatureResourceAction<T> =
  | { type: 'started' }
  | { type: 'resolved'; data: T }
  | { type: 'rejected'; message: string };

export function initialFeatureResourceState<T>(): FeatureResourceState<T> {
  return { status: 'idle', data: null, error: null };
}

export function reduceFeatureResource<T>(
  state: FeatureResourceState<T>,
  action: FeatureResourceAction<T>,
): FeatureResourceState<T> {
  if (action.type === 'started') {
    return {
      status: state.data === null ? 'loading' : 'refreshing',
      data: state.data,
      error: null,
    };
  }
  if (action.type === 'resolved') {
    return { status: 'ready', data: action.data, error: null };
  }
  return { status: 'error', data: state.data, error: action.message };
}

export function featureErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError || error instanceof Error) {
    return error.message;
  }
  return '页面数据加载失败';
}

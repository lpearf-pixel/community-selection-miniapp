import { useEffect, useReducer, useRef, useState } from 'react';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
  type FeatureResourceState,
} from './feature-resource';

export type FeatureLoader<T> = (signal: AbortSignal) => Promise<T>;

export function isCurrentFeatureLoad(input: {
  aborted: boolean;
  generation: number;
  currentGeneration: number;
}): boolean {
  return (
    !input.aborted &&
    input.generation === input.currentGeneration
  );
}

export function useFeatureResourceLoader<T>(
  loader: FeatureLoader<T>,
  refreshVersion: number,
): {
  state: FeatureResourceState<T>;
  retry: () => void;
} {
  const [retryVersion, setRetryVersion] = useState(0);
  const generationRef = useRef(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<T>,
    initialFeatureResourceState<T>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    dispatch({ type: 'started' });

    void loader(controller.signal).then(
      (data) => {
        if (
          isCurrentFeatureLoad({
            aborted: controller.signal.aborted,
            generation,
            currentGeneration: generationRef.current,
          })
        ) {
          dispatch({ type: 'resolved', data });
        }
      },
      (error: unknown) => {
        if (
          isCurrentFeatureLoad({
            aborted: controller.signal.aborted,
            generation,
            currentGeneration: generationRef.current,
          })
        ) {
          dispatch({
            type: 'rejected',
            message: featureErrorMessage(error),
          });
        }
      },
    );

    return () => controller.abort();
  }, [loader, refreshVersion, retryVersion]);

  return {
    state,
    retry: () => setRetryVersion((value) => value + 1),
  };
}

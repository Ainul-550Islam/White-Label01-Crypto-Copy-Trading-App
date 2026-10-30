'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-error';

/**
 * One loader for one console read.
 *
 * Every operator panel shows the same four states - loading, error, empty,
 * loaded - and every one of them must survive an operator paging quickly or
 * navigating away mid-request. Doing that by hand in five components is how a
 * late response from page 1 overwrites page 2, so the guarantees live here:
 *
 *  * only the newest request may write state (`requestId` guard);
 *  * a reload keeps the previous data on screen instead of collapsing the table
 *    to a spinner and yanking the scroll position;
 *  * the error message is a safe, human sentence. `ApiError.message` is the
 *    API's own user-facing copy; anything else (a network throw, a parse
 *    failure) becomes one generic sentence, so a stack trace cannot reach the
 *    console.
 *
 * "Loading" is derived state, not a flag flipped at the top of the effect: it is
 * true until the first response for the current inputs settles. That is why a
 * filter change does not blank the table - the rows for the previous filter stay
 * until the new ones arrive.
 */
export interface Resource<T> {
  data: T | null;
  loading: boolean;
  /** Safe, already-human copy. Never a raw server error. */
  error: string | null;
  /** Error code from the API envelope, for mapping 403/409/422 to specific copy. */
  errorCode: string | null;
  errorStatus: number | null;
  reload: () => void;
}

export interface ResourceOptions {
  /** Set false to skip the automatic load (e.g. a required filter is empty). */
  enabled?: boolean;
  /** Copy shown when the request fails without a body the console can explain. */
  errorMessage?: string;
}

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  errorCode: string | null;
  errorStatus: number | null;
  /** True once a response (success or failure) has been applied at least once. */
  settled: boolean;
}

function initialState<T>(): ResourceState<T> {
  return { data: null, error: null, errorCode: null, errorStatus: null, settled: false };
}

export function useResource<T>(
  load: () => Promise<T>,
  dependencies: ReadonlyArray<unknown>,
  { enabled = true, errorMessage = 'This data could not be loaded. Please try again.' }: ResourceOptions = {},
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>(initialState<T>);
  const [nonce, setNonce] = useState(0);

  const requestId = useRef(0);
  // The loader is usually an inline arrow function, so keep the newest one in a
  // ref rather than adding it to the dependency list (which would loop forever).
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!enabled) return;

    requestId.current += 1;
    const current = requestId.current;
    let cancelled = false;

    loadRef
      .current()
      .then((result) => {
        if (cancelled || current !== requestId.current) return;
        setState({ data: result, error: null, errorCode: null, errorStatus: null, settled: true });
      })
      .catch((caught: unknown) => {
        if (cancelled || current !== requestId.current) return;
        if (caught instanceof ApiError) {
          setState({ data: null, error: caught.message || errorMessage, errorCode: caught.code, errorStatus: caught.status, settled: true });
        } else {
          setState({ data: null, error: errorMessage, errorCode: null, errorStatus: null, settled: true });
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, errorMessage, ...dependencies]);

  const reload = useCallback(() => {
    // Clearing `settled` in the click handler (not in an effect) is what puts the
    // panel back into its loading state for a deliberate refresh.
    setState((current) => ({ ...current, settled: false }));
    setNonce((value) => value + 1);
  }, []);

  return {
    data: state.data,
    loading: enabled && !state.settled,
    error: state.error,
    errorCode: state.errorCode,
    errorStatus: state.errorStatus,
    reload,
  };
}

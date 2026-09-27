/** Lightweight result type for flows where exceptions are not appropriate. */

export type Result<TValue, TError = Error> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

export function unwrapOr<TValue, TError>(result: Result<TValue, TError>, fallback: TValue): TValue {
  return result.ok ? result.value : fallback;
}

export async function tryCatch<TValue>(
  operation: () => Promise<TValue>,
): Promise<Result<TValue, Error>> {
  try {
    return ok(await operation());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

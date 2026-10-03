/** Random idempotency key for a single user-initiated mutation (retries reuse it). */
export function newIdempotencyKey(prefix = "req"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

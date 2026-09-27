/** Duration parsing shared by JWT configuration, caches and queue backoffs. */

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?$/i;

const UNIT_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(duration: string | number): number {
  if (typeof duration === 'number') {
    return duration;
  }
  const match = DURATION_PATTERN.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unsupported duration unit: "${unit}"`);
  }
  return Math.floor(value * multiplier);
}

export function parseDurationToSeconds(duration: string | number): number {
  return Math.floor(parseDurationToMs(duration) / 1000);
}

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMilliseconds(date, seconds * 1000);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry.getTime() <= now.getTime();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Exponential backoff with full jitter, capped. */
export function backoffWithJitter(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exponential);
}

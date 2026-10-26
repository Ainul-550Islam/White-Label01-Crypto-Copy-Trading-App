// # Maps queue processing failures to deterministic terminal or exponential-retry policy.
export interface QueueRetryPolicy {
  retryable: boolean;
  attempts: number;
  backoff: { type: 'exponential'; delay: number } | null;
}

export function classifyQueueFailure(
  error: unknown,
  defaults: { attempts: number; backoffMs: number },
): QueueRetryPolicy {
  const candidate = error as { retryable?: unknown; terminal?: unknown } | null;
  const terminal = candidate?.retryable === false || candidate?.terminal === true;
  return terminal
    ? { retryable: false, attempts: 1, backoff: null }
    : {
        retryable: true,
        attempts: Math.max(1, defaults.attempts),
        backoff: { type: 'exponential', delay: Math.max(1, defaults.backoffMs) },
      };
}

export function defaultQueueJobOptions(config: {
  queueDefaultAttempts: number;
  queueBackoffMs: number;
  queueRemoveOnComplete: number;
  queueRemoveOnFail: number;
}) {
  return {
    attempts: config.queueDefaultAttempts,
    backoff: { type: 'exponential' as const, delay: config.queueBackoffMs },
    removeOnComplete: config.queueRemoveOnComplete,
    removeOnFail: config.queueRemoveOnFail,
  };
}

export function repeatableJobId(jobName: string): string {
  const safe = jobName
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('A non-empty repeatable job name is required.');
  return `repeat-${safe}`;
}

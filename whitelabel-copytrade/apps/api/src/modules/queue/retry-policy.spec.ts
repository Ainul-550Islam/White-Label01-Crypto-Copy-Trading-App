// # Exercises retry/backoff mapping for transient errors and single-attempt terminal errors.
import { classifyQueueFailure, defaultQueueJobOptions, repeatableJobId } from './retry-policy';

describe('queue retry policy', () => {
  it('maps transient failures to configured exponential retries', () => {
    expect(
      classifyQueueFailure(new Error('redis timeout'), { attempts: 5, backoffMs: 2500 }),
    ).toEqual({
      retryable: true,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2500 },
    });
  });

  it('maps explicitly terminal failures to one attempt and no backoff', () => {
    expect(classifyQueueFailure({ terminal: true }, { attempts: 5, backoffMs: 2500 })).toEqual({
      retryable: false,
      attempts: 1,
      backoff: null,
    });
    expect(
      classifyQueueFailure({ retryable: false }, { attempts: 5, backoffMs: 2500 }).attempts,
    ).toBe(1);
  });

  it('sanitizes repeat job ids so none contain BullMQ-forbidden colons', () => {
    expect(repeatableJobId('prune:expired tokens')).toBe('repeat-prune-expired-tokens');
    expect(repeatableJobId('prune:expired tokens')).not.toContain(':');
    expect(
      defaultQueueJobOptions({
        queueDefaultAttempts: 5,
        queueBackoffMs: 2500,
        queueRemoveOnComplete: 100,
        queueRemoveOnFail: 200,
      }),
    ).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2500 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  });
});

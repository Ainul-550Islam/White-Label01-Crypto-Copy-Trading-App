// # Asserts the queue module maps central retry configuration into BullMQ defaults.
import { defaultQueueJobOptions } from './retry-policy';

describe('queue module retry defaults', () => {
  it('preserves the configured retry count, exponential backoff, and retention bounds', () => {
    expect(
      defaultQueueJobOptions({
        queueDefaultAttempts: 7,
        queueBackoffMs: 4000,
        queueRemoveOnComplete: 250,
        queueRemoveOnFail: 750,
      }),
    ).toEqual({
      attempts: 7,
      backoff: { type: 'exponential', delay: 4000 },
      removeOnComplete: 250,
      removeOnFail: 750,
    });
  });
});

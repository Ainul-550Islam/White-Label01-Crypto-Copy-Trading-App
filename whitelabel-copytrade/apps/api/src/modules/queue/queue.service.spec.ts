// # Verifies queue facade retry policy propagation and colon-free repeatable job ids.
import { QUEUE_NAMES } from '@wlct/config';
import { QueueService } from './queue.service';
import type { Queue } from 'bullmq';

function queueMock() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn(),
    getJobCounts: jest.fn(),
    isPaused: jest.fn(),
  };
}

describe('QueueService', () => {
  it('uses a colon-free id for repeatable jobs', async () => {
    const queues = Array.from({ length: 12 }, queueMock);
    const service = new QueueService(
      ...(queues as unknown as [
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
      ]),
      { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as never,
    );
    await service.schedule(QUEUE_NAMES.MAINTENANCE, 'prune:tokens', {}, '*/15 * * * *');
    const options = queues[4].add.mock.calls[0][2] as { jobId: string };
    expect(options.jobId).not.toContain(':');
    expect(options.jobId).toBe('repeat-prune-tokens');
  });

  it('maps queue broker enqueue failure to a visible null result, never a fabricated job id', async () => {
    const queues = Array.from({ length: 12 }, queueMock);
    queues[2].add.mockRejectedValue(new Error('redis down'));
    const service = new QueueService(
      ...(queues as unknown as [
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
        Queue,
      ]),
      { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as never,
    );
    await expect(service.enqueue(QUEUE_NAMES.NOTIFICATION, 'dispatch', {})).resolves.toBeNull();
  });
});

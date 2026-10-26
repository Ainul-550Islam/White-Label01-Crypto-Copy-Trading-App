// # Verifies an unknown maintenance job terminates safely without mutating retained rows.
import { MaintenanceProcessor } from './maintenance.processor';

describe('MaintenanceProcessor', () => {
  it('returns a terminal no-op for an unknown job name', async () => {
    const processor = new MaintenanceProcessor(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        withJobContext: (
          _queue: string,
          _id: string,
          _operation: string,
          callback: () => unknown,
        ) => callback(),
      } as never,
      { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as never,
    );
    const result = await processor.process({ name: 'unknown-job', id: 'job-1', data: {} } as never);
    expect(result).toEqual({ removed: 0 });
  });
});

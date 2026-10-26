// # Confirms repeatable maintenance schedules are registered with stable cadence and no duplicate process-local logic.
import { MaintenanceScheduler } from './maintenance.scheduler';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

describe('MaintenanceScheduler', () => {
  it('registers core maintenance jobs and SLO cadence when enabled', async () => {
    const schedule = jest.fn().mockResolvedValue(undefined);
    const logger = { info: jest.fn(), error: jest.fn() };
    const scheduler = new MaintenanceScheduler(
      { schedule } as never,
      {
        sloEnabled: true,
        sloEvaluationIntervalMinutes: 5,
        sloRetentionDays: 30,
        alertRetentionDays: 30,
        incidentRetentionDays: 365,
      } as never,
      logger as never,
    );
    await scheduler.onApplicationBootstrap();
    expect(schedule).toHaveBeenCalledWith(
      QUEUE_NAMES.MAINTENANCE,
      JOB_NAMES.PRUNE_EXPIRED_TOKENS,
      {},
      '*/15 * * * *',
    );
    expect(schedule).toHaveBeenCalledWith(
      QUEUE_NAMES.MAINTENANCE,
      JOB_NAMES.EVALUATE_OPERATIONAL_SLOS,
      {},
      '*/5 * * * *',
    );
  });
});

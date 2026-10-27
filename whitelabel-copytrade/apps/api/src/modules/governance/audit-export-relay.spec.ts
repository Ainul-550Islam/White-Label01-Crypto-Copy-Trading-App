import { AuditExportRelayService } from './audit-export-relay.service';

afterEach(() => jest.useRealTimers());

test('relay starts once, retries on schedule and stops with the Nest module', async () => {
  jest.useFakeTimers();
  const exports = { relayPendingExports: jest.fn().mockResolvedValue(undefined) };
  const relay = new AuditExportRelayService(exports as any);
  relay.onModuleInit();
  relay.onModuleInit();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(exports.relayPendingExports).toHaveBeenCalledTimes(2);
  relay.onModuleDestroy();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(exports.relayPendingExports).toHaveBeenCalledTimes(2);
});

test('a failed relay tick does not prevent later scheduled attempts', async () => {
  jest.useFakeTimers();
  const exports = { relayPendingExports: jest.fn().mockRejectedValueOnce(new Error('private detail')).mockResolvedValue(undefined) };
  const relay = new AuditExportRelayService(exports as any);
  relay.onModuleInit();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(exports.relayPendingExports).toHaveBeenCalledTimes(2);
  relay.onModuleDestroy();
});

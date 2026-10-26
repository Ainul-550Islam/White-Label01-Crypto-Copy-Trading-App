// # Regresses preference opt-out enforcement and durable delivery-failure recording.
import { NotificationChannel } from '@wlct/shared-types';
import { JOB_NAMES } from '@wlct/config';
import { NotificationProcessor } from './notification.processor';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

describe('NotificationProcessor', () => {
  it('honors an opted-out channel for non-critical notifications', async () => {
    const prisma = {
      notificationPreference: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ channel: NotificationChannel.EMAIL, enabled: false }]),
      },
    } as unknown as PrismaService;
    const processor = new NotificationProcessor(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn() } as never,
    );
    const channels = await (
      processor as unknown as {
        filterByPreferences: (
          user: string,
          category: string,
          channels: NotificationChannel[],
          critical: boolean,
        ) => Promise<NotificationChannel[]>;
      }
    ).filterByPreferences('user-1', 'billing', [NotificationChannel.EMAIL], false);
    expect(channels).toEqual([]);
  });

  it('records unsupported delivery failures instead of dropping the notification', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'notification-1' });
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'u@example.test',
          status: 'ACTIVE',
          profile: null,
        }),
      },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Tenant', defaultLocale: 'en', branding: null }),
      },
      notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
      notification: { create },
    } as unknown as PrismaService;
    const processor = new NotificationProcessor(
      prisma,
      {} as never,
      { translate: (key: string) => key } as never,
      {} as never,
      { appName: 'WLCT', queueRunInlineWorkers: true } as never,
      { info: jest.fn(), warn: jest.fn() } as never,
    );
    await processor.process({
      name: JOB_NAMES.DISPATCH_NOTIFICATION,
      data: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        type: 'account.welcome',
        channels: [NotificationChannel.PUSH],
        data: {},
      },
    } as never);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          channel: NotificationChannel.PUSH,
          failureReason: expect.stringContaining('No transport configured'),
          failedAt: expect.any(Date),
        }),
      }),
    );
  });
});

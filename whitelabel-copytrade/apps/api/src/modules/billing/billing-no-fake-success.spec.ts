/**
 * Billing paths that used to report success (or a number) they had not
 * earned. Each case pins the honest behaviour.
 */
import { NotFoundException } from '@nestjs/common';
import { PushNotificationService } from './notifications/push-notification.service';
import { NotificationProviderFactory } from './notifications/notification-provider.factory';
import { NotificationChannel } from './notifications/billing-notification.types';
import { PayoutProviderFactory } from './fees/payout-provider.factory';
import { PayoutProvider } from './fees/payout.types';
import { PaymentRepository } from './payments/payment.repository';
import { UsageExportService } from './usage/usage-export.service';
import { ChurnAnalyticsService } from './analytics/churn-analytics.service';
import { PlanRepository } from './plans/plan.repository';
import { InAppNotificationService } from './notifications/in-app-notification.service';

const ENV_KEYS = [
  'PUSH_ENABLED',
  'FCM_SERVER_KEY',
  'FIREBASE_CONFIG',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY_BASE64',
  'SMS_PROVIDER',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY_SID',
  'TWILIO_API_KEY_SECRET',
  'TWILIO_MESSAGING_SERVICE_SID',
  'TWILIO_FROM_NUMBER',
  'TWILIO_STATUS_CALLBACK_URL',
  'STRIPE_SECRET_KEY',
  'PAYOUT_PROVIDER',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const pushInput = (payload: Record<string, unknown> = {}) =>
  ({
    tenantId: 't1',
    recipientUserId: 'u1',
    subject: 'Invoice ready',
    body: 'Your invoice is ready',
    safePayload: payload,
  }) as any;

describe('push notifications never report an unsent push as delivered', () => {
  it('not configured -> PUSH_NOT_CONFIGURED', async () => {
    const r = await new PushNotificationService().send(pushInput({ deviceToken: 'a'.repeat(40) }));
    expect(r.accepted).toBe(false);
    expect(r.errorCode).toBe('PUSH_NOT_CONFIGURED');
  });

  it('enabled without a device token -> NO_DEVICE_TOKEN', async () => {
    process.env.PUSH_ENABLED = 'true';
    const r = await new PushNotificationService().send(pushInput());
    expect(r.accepted).toBe(false);
    expect(r.errorCode).toBe('NO_DEVICE_TOKEN');
  });

  it('enabled but no FCM client -> PUSH_PROVIDER_UNAVAILABLE (was accepted: push_dev_*)', async () => {
    process.env.PUSH_ENABLED = 'true';
    const svc = new PushNotificationService();
    jest.spyOn(svc as any, 'resolveMessaging').mockResolvedValue(null);
    const r = await svc.send(pushInput({ deviceToken: 'a'.repeat(40) }));
    expect(r.accepted).toBe(false);
    expect(r.errorCode).toBe('PUSH_PROVIDER_UNAVAILABLE');
    expect(r.providerReference).toBeNull();
  });

  it('accepted only with the id FCM returned', async () => {
    process.env.PUSH_ENABLED = 'true';
    const svc = new PushNotificationService();
    const send = jest.fn(async () => 'projects/p/messages/123');
    jest.spyOn(svc as any, 'resolveMessaging').mockResolvedValue({ send });
    const r = await svc.send(pushInput({ deviceToken: 'a'.repeat(40) }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ token: 'a'.repeat(40) }));
    expect(r.accepted).toBe(true);
    expect(r.providerReference).toBe('projects/p/messages/123');
  });

  it('FCM unregistered token -> permanent failure; other errors retryable', async () => {
    process.env.PUSH_ENABLED = 'true';
    const svc = new PushNotificationService();
    const err = Object.assign(new Error('Requested entity was not found.'), {
      code: 'messaging/registration-token-not-registered',
    });
    jest.spyOn(svc as any, 'resolveMessaging').mockResolvedValue({
      send: jest.fn(async () => {
        throw err;
      }),
    });
    const bad = await svc.send(pushInput({ deviceToken: 'a'.repeat(40) }));
    expect(bad).toMatchObject({
      accepted: false,
      retryable: false,
      errorCode: 'INVALID_DEVICE_TOKEN',
    });

    jest.spyOn(svc as any, 'resolveMessaging').mockResolvedValue({
      send: jest.fn(async () => {
        throw new Error('socket hang up');
      }),
    });
    const temp = await svc.send(pushInput({ deviceToken: 'a'.repeat(40) }));
    expect(temp).toMatchObject({
      accepted: false,
      retryable: true,
      errorCode: 'PUSH_TEMPORARY_FAILURE',
    });
  });
});

describe('notification provider factory', () => {
  const email = { isAvailable: () => false } as any;

  it('routes PUSH to the real push adapter when configured', () => {
    process.env.PUSH_ENABLED = 'true';
    const push = new PushNotificationService();
    const factory = new NotificationProviderFactory(email, push);
    expect(factory.getProvider(NotificationChannel.PUSH)).toBe(push);
  });

  it('SMS (twilio selected but unconfigured) and WEBHOOK get an unavailable provider, never an always-accepting stub', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    const factory = new NotificationProviderFactory(email, new PushNotificationService());
    for (const channel of [NotificationChannel.SMS, NotificationChannel.WEBHOOK]) {
      const p = factory.getProvider(channel);
      expect(p.isAvailable()).toBe(false);
      await expect(p.send({} as any)).rejects.toThrow(/not configured/);
    }
  });
});

describe('notification provider factory: SMS', () => {
  const email = { isAvailable: () => false } as any;

  it('SMS_PROVIDER=twilio with full configuration routes SMS to the Twilio adapter', () => {
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC' + 'a'.repeat(32);
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    const factory = new NotificationProviderFactory(email, new PushNotificationService());
    const p = factory.getProvider(NotificationChannel.SMS);
    expect(p.providerName).toBe('twilio');
    expect(p.isAvailable()).toBe(true);
    expect(factory.getAvailableChannels()).toContain(NotificationChannel.SMS);
  });

  it('an unsupported SMS_PROVIDER fails closed', () => {
    process.env.SMS_PROVIDER = 'nexmo';
    process.env.TWILIO_ACCOUNT_SID = 'AC' + 'a'.repeat(32);
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15005550006';
    const factory = new NotificationProviderFactory(email, new PushNotificationService());
    expect(factory.getProvider(NotificationChannel.SMS).isAvailable()).toBe(false);
    expect(factory.getAvailableChannels()).not.toContain(NotificationChannel.SMS);
  });
});

describe('push: explicit Firebase service account', () => {
  it('needs all three FIREBASE_* variables and a PEM key', () => {
    process.env.FIREBASE_PROJECT_ID = 'p';
    process.env.FIREBASE_CLIENT_EMAIL = 'svc@p.iam.gserviceaccount.com';
    expect(PushNotificationService.serviceAccountFromEnv()).toBeNull();
    process.env.FIREBASE_PRIVATE_KEY_BASE64 = Buffer.from('not a key').toString('base64');
    expect(PushNotificationService.serviceAccountFromEnv()).toBeNull();
    process.env.FIREBASE_PRIVATE_KEY_BASE64 = Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n').toString('base64');
    expect(PushNotificationService.serviceAccountFromEnv()).toMatchObject({ projectId: 'p', clientEmail: 'svc@p.iam.gserviceaccount.com' });
    expect(new PushNotificationService().isAvailable()).toBe(true);
  });
});

describe('payout provider factory', () => {
  it('STRIPE without a usable secret key fails closed (never the always-SUCCEEDED ledger)', () => {
    process.env.PAYOUT_PROVIDER = 'stripe';
    expect(new PayoutProviderFactory().getProvider(PayoutProvider.STRIPE).isAvailable()).toBe(false);
    process.env.STRIPE_SECRET_KEY = 'pk_test_publishable';
    expect(new PayoutProviderFactory().getProvider(PayoutProvider.STRIPE).isAvailable()).toBe(false);
  });

  it('STRIPE with a secret key returns the Stripe Connect adapter', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.PAYOUT_PROVIDER = 'stripe';
    const p = new PayoutProviderFactory().getProvider(PayoutProvider.STRIPE);
    expect(p.providerName).toBe(PayoutProvider.STRIPE);
    expect(p.isAvailable()).toBe(true);
  });
});

describe('payment repository', () => {
  it('fails closed when the Payment table is missing instead of returning an unpersisted record', async () => {
    const prisma = {
      payment: {
        create: jest.fn(async () => {
          throw Object.assign(new Error('The table `payments` does not exist'), { code: 'P2021' });
        }),
      },
    };
    const repo = new PaymentRepository(prisma as any);
    await expect(
      repo.create({
        tenantId: 't1',
        planId: 'p1',
        provider: 'STRIPE',
        currency: 'USD',
        amount: { amount: '10.00', amountInSmallestUnit: 1000 },
        idempotencyKey: 'k',
        references: {},
        metadata: {},
      } as any),
    ).rejects.toThrow('Failed to create payment record');
  });

  it('fails closed when the Prisma client has no Payment delegate', async () => {
    const repo = new PaymentRepository({} as any);
    await expect(
      repo.create({
        tenantId: 't1',
        planId: 'p1',
        provider: 'STRIPE',
        currency: 'USD',
        amount: { amount: '1', amountInSmallestUnit: 100 },
        idempotencyKey: 'k',
        references: {},
        metadata: {},
      } as any),
    ).rejects.toThrow('Payment storage is unavailable');
  });
});

describe('usage export status', () => {
  it('does not invent COMPLETED for an untracked export id', async () => {
    const svc = new UsageExportService({} as any, {} as any, {} as any, {} as any);
    await expect(svc.getExportStatus('anything', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('churn: revenue retention comes from revenue churn', () => {
  function service(opts: { mrrAtStartMinor: number; churned: any[] }) {
    const svc = new ChurnAnalyticsService({} as any);
    const active = [{ tenantId: 'a' }, { tenantId: 'b' }, { tenantId: 'c' }, { tenantId: 'd' }];
    jest.spyOn(svc as any, 'fetchActiveAtDate').mockResolvedValue(active);
    jest.spyOn(svc as any, 'fetchChurnedInPeriod').mockResolvedValue(opts.churned);
    jest
      .spyOn(svc as any, 'calculateMrrAtDate')
      .mockResolvedValue({ totalMinor: opts.mrrAtStartMinor });
    return svc;
  }
  const period = {
    type: 'MONTHLY',
    startDate: '2026-08-01T00:00:00Z',
    endDate: '2026-09-01T00:00:00Z',
  } as any;

  it('GRR = 100 - revenue churn %, NRR unknown (null)', async () => {
    // One of four subscriptions churned (25% by count) but it carried 10% of MRR.
    const churned = [
      {
        tenantId: 'a',
        status: 'CANCELED',
        cancelReason: 'too expensive',
        plan: { currency: 'USD', price: '100.00', interval: 'MONTHLY' },
      },
    ];
    const m = await service({ mrrAtStartMinor: 100_000, churned }).calculateChurn({
      period,
      currency: 'USD',
    });
    expect(m.subscriptionChurnRate).toBe('25.00');
    expect(m.revenueChurnRate).toBe('10.00');
    expect(m.grossRevenueRetention).toBe('90.00');
    expect(m.netRevenueRetention).toBeNull();
  });

  it('no MRR at start -> both retention figures null, not 100%', async () => {
    const m = await service({ mrrAtStartMinor: 0, churned: [] }).calculateChurn({
      period,
      currency: 'USD',
    });
    expect(m.grossRevenueRetention).toBeNull();
    expect(m.netRevenueRetention).toBeNull();
  });
});

describe('plan repository delete is tenant-scoped', () => {
  it('deletes by id AND tenant, and reports a miss', async () => {
    const deleteMany = jest.fn(async () => ({ count: 0 }));
    const repo = new PlanRepository({ plan: { deleteMany } } as any);
    await expect(repo.delete('plan-1', 'tenant-a')).rejects.toThrow('Plan not found');
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'plan-1', tenantId: 'tenant-a' } });
  });
});

describe('in-app notifications publish realtime for real', () => {
  it('emits NOTIFICATION_CREATED to the user after persisting', async () => {
    const record = { id: 'n1' };
    const prisma = { notification: { create: jest.fn(async () => record) } };
    const realtime = { emitToUser: jest.fn(async () => undefined) };
    const svc = new InAppNotificationService(prisma as any, realtime as any);
    const out = await svc.createNotification({
      tenantId: 't1',
      userId: 'u1',
      eventKey: 'invoice.ready',
      title: 'T',
      body: 'B',
      safePayload: {},
      channel: 'IN_APP',
      idempotencyKey: 'idem-1',
    } as any);
    expect(out).toBe(record);
    expect(realtime.emitToUser).toHaveBeenCalledWith('t1', 'u1', 'notification.created', {
      id: 'n1',
      type: 'invoice.ready',
      title: 'T',
    });
  });

  it('a realtime failure does not lose the persisted notification', async () => {
    const record = { id: 'n2' };
    const prisma = { notification: { create: jest.fn(async () => record) } };
    const realtime = {
      emitToUser: jest.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const svc = new InAppNotificationService(prisma as any, realtime as any);
    await expect(
      svc.createNotification({
        tenantId: 't1',
        userId: 'u1',
        eventKey: 'e',
        title: 'T',
        body: 'B',
        safePayload: {},
        channel: 'IN_APP',
        idempotencyKey: 'idem-1',
      } as any),
    ).resolves.toBe(record);
  });
});

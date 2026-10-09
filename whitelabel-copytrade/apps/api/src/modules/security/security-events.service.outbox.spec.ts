// # Proves the legacy security-event facade routes writes through the transactional outbox owner

import { SecurityEventType, SecuritySeverity } from '@wlct/shared-types';
import { SecurityEventsService } from './security-events.service';
import { SecurityEventService } from './security-event.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('SecurityEventsService transactional outbox delegation', () => {
  it('routes tenant security events through the canonical outbox-backed writer', async () => {
    const prisma = {
      securityEvent: { create: jest.fn() },
    };
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    };
    const eventWriter = {
      record: jest.fn(async (_input: {
        tenantId: string | null;
        userId?: string | null;
        type: string;
        severity: string;
        description: string;
        safeMetadata?: Record<string, unknown> | null;
        metadata?: Record<string, unknown> | null;
        ipHash?: string | null;
        userAgent?: string | null;
        requestId?: string | null;
      }) => undefined),
    };
    const service = new SecurityEventsService(
      prisma as never,
      logger as never,
      eventWriter as unknown as SecurityEventService,
    );

    await service.record({
      tenantId: TENANT_ID,
      userId: 'user-1',
      type: SecurityEventType.SUSPICIOUS_LOGIN,
      severity: SecuritySeverity.HIGH,
      description: 'MFA failure\nwith an untrusted line break.',
      metadata: { token: 'must-not-leave-the-security-event' },
      ipHash: 'ip-hash-1',
      userAgent: 'trusted browser string',
      requestId: 'request-1',
    });

    expect(eventWriter.record).toHaveBeenCalledTimes(1);
    const recorded = eventWriter.record.mock.calls[0]?.[0];
    expect(recorded).toMatchObject({
      tenantId: TENANT_ID,
      userId: 'user-1',
      type: SecurityEventType.SUSPICIOUS_LOGIN,
      severity: SecuritySeverity.HIGH,
      ipHash: 'ip-hash-1',
      requestId: 'request-1',
    });
    expect(recorded?.description).not.toContain('\n');
    expect(JSON.stringify(recorded)).not.toContain('must-not-leave-the-security-event');
    expect(prisma.securityEvent.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('propagates canonical writer failures rather than silently dropping a tenant security event', async () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    };
    const eventWriter = {
      record: jest.fn(async () => {
        throw new Error('transactional security outbox unavailable');
      }),
    };
    const service = new SecurityEventsService(
      {} as never,
      logger as never,
      eventWriter as unknown as SecurityEventService,
    );

    await expect(service.record({
      tenantId: TENANT_ID,
      type: SecurityEventType.TOKEN_REUSE,
      severity: SecuritySeverity.CRITICAL,
      description: 'A refresh token was reused.',
    })).rejects.toThrow('transactional security outbox unavailable');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

// # Proves tenant-owned security-event records commit with sanitized webhook events

import { SecurityEventService } from './security-event.service';
import { SecurityEventType, SecurityRisk } from './security.types';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function buildService(options: { failAppend?: boolean } = {}) {
  let persisted: any = null;
  const tx = {
    securityEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        persisted = { ...data };
        return persisted;
      }),
    },
  };
  const prisma: any = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const before = persisted;
      try {
        return await work(tx);
      } catch (error) {
        persisted = before;
        throw error;
      }
    }),
    securityAuditLog: { create: jest.fn(async () => ({})) },
  };
  const outbox = {
    append: jest.fn(async (_transaction: unknown, _input: Record<string, unknown>) => {
      if (options.failAppend) throw new Error('outbox unavailable');
      return undefined;
    }),
  };
  const service = new SecurityEventService(prisma as never, outbox as never);
  return { service, prisma, tx, outbox, persisted: () => persisted };
}

describe('SecurityEventService outbox transaction', () => {
  it('records a tenant security event and its redacted public event atomically', async () => {
    const { service, prisma, tx, outbox, persisted } = buildService();
    await service.record({
      tenantId: TENANT_ID,
      userId: 'user-1',
      type: SecurityEventType.MFA_FAILURE,
      severity: SecurityRisk.HIGH,
      description: 'MFA verification failed.',
      safeMetadata: { factor: 'TOTP', token: 'must-not-leave-the-security-table' },
      requestId: 'request-1',
    });

    const securityEventId = persisted().id;
    expect(prisma.withTenantRls).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(tx.securityEvent.create).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      tenantId: TENANT_ID,
      aggregateType: 'security_event',
      aggregateId: securityEventId,
      eventType: 'security.event',
      idempotencyKey: `security-event:${securityEventId}:recorded`,
      correlationId: 'request-1',
      payload: {
        securityEventId,
        category: SecurityEventType.MFA_FAILURE,
        severity: 'WARNING',
      },
    }));
    const event = outbox.append.mock.calls[0]?.[1];
    expect(validateDeveloperEventPayload('security.event', event?.payload)).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(event)).not.toContain('must-not-leave-the-security-table');
  });

  it('propagates an outbox failure so the transaction rolls back instead of silently losing delivery', async () => {
    const { service, tx, persisted } = buildService({ failAppend: true });
    await expect(service.record({
      tenantId: TENANT_ID,
      type: SecurityEventType.LOGIN_SUCCESS,
      severity: SecurityRisk.LOW,
      description: 'Login success.',
    })).rejects.toThrow('outbox unavailable');

    expect(tx.securityEvent.create).toHaveBeenCalledTimes(1);
    expect(persisted()).toBeNull();
  });

  it('rejects an invalid non-null tenant instead of downgrading it to a platform event', async () => {
    const { service, prisma, outbox } = buildService();

    await expect(service.record({
      tenantId: 'not-a-tenant-uuid',
      type: SecurityEventType.LOGIN_FAILURE,
      severity: SecurityRisk.HIGH,
      description: 'Invalid tenant event.',
    })).rejects.toThrow('tenantId must be a UUID or null');

    expect(prisma.withTenantRls).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects unknown severities instead of projecting them as informational', async () => {
    const { service, prisma, outbox } = buildService();

    await expect(service.record({
      tenantId: TENANT_ID,
      type: SecurityEventType.LOGIN_FAILURE,
      severity: 'UNRECOGNIZED' as SecurityRisk,
      description: 'Invalid severity event.',
    })).rejects.toThrow('severity is invalid');

    expect(prisma.withTenantRls).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});

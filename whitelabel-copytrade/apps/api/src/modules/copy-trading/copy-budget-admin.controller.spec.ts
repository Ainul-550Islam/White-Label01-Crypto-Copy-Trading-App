// # Responsibility: proves the operator copy-budget routes are permission- and step-up-gated on the tenant from the JWT, that the write is audited with both the previous and the new ceiling, and that the decimal strings a client sends are passed through without being re-typed as floats.
import 'reflect-metadata';
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { CopyBudgetAdminController } from './copy-budget-admin.controller';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

function auditSpy() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

describe('CopyBudgetAdminController', () => {
  describe('authorisation metadata', () => {
    it('requires copy-subscription read for the ceiling and manage for the over-cap list', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CopyBudgetAdminController.prototype.getDefaultCaps)).toEqual([
        Permission.COPY_SUBSCRIPTION_READ,
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, CopyBudgetAdminController.prototype.listOverCapUsers)).toEqual([
        Permission.COPY_SUBSCRIPTION_MANAGE,
      ]);
    });

    it('puts a step-up proof on the write and on nothing else', () => {
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, CopyBudgetAdminController.prototype.setDefaultCaps)).toBe(
        'COPY_BUDGET_DEFAULT_UPDATE',
      );
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, CopyBudgetAdminController.prototype.getDefaultCaps)).toBeUndefined();
      expect(
        Reflect.getMetadata(REQUIRE_STEP_UP_KEY, CopyBudgetAdminController.prototype.listOverCapUsers),
      ).toBeUndefined();
    });

    it('keeps the write behind a permission as well as the step-up, so proof alone is not authorisation', () => {
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, CopyBudgetAdminController.prototype.setDefaultCaps);
      const mode = Reflect.getMetadata(PERMISSIONS_MODE_KEY, CopyBudgetAdminController.prototype.setDefaultCaps);

      expect(permissions).toEqual([Permission.COPY_SUBSCRIPTION_MANAGE]);
      // 'all' mode: adding a permission later must not widen this route by accident.
      expect(mode).toBe('all');
    });
  });

  describe('tenant scoping', () => {
    it('reads and writes only the tenant resolved from the JWT', async () => {
      const budgets = {
        getTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: '100.00', currency: 'USDT', updatedAt: null, status: 'CONFIGURED' }),
        setTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: '250.50', currency: 'USDT', updatedAt: '2026-10-30T00:00:00.000Z', status: 'CONFIGURED' }),
        listOverCapUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      };
      const audit = auditSpy();
      const controller = new CopyBudgetAdminController(budgets as never, audit as never);

      await controller.getDefaultCaps(TENANT_ID);
      await controller.listOverCapUsers(TENANT_ID, {});
      await controller.setDefaultCaps(
        { userId: USER_ID, tenantId: TENANT_ID } as never,
        TENANT_ID,
        { maxActiveExposure: '250.50', currency: 'USDT' } as never,
        { requestId: 'req-1', ipHash: 'ip-hash-1' } as never,
      );

      expect(budgets.getTenantDefaultCaps).toHaveBeenCalledWith(TENANT_ID);
      expect(budgets.listOverCapUsers).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID }),
      );
      expect(budgets.setTenantDefaultCaps).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, actorId: USER_ID }),
      );
      // A tenant header a client might send is not an input to any of these calls:
      // the controller never reads one, so only the JWT tenant can appear here.
      expect(budgets.setTenantDefaultCaps).not.toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: OTHER_TENANT_ID }),
      );
    });
  });

  describe('audit', () => {
    it('records the previous and the next ceiling, as strings, once the write succeeded', async () => {
      const budgets = {
        getTenantDefaultCaps: jest.fn().mockResolvedValue({
          maxActiveExposure: '1000.00',
          currency: 'USDT',
          updatedAt: '2026-10-01T00:00:00.000Z',
          status: 'CONFIGURED',
        }),
        setTenantDefaultCaps: jest.fn().mockResolvedValue({
          maxActiveExposure: '500.25',
          currency: 'USDT',
          updatedAt: '2026-10-30T00:00:00.000Z',
          status: 'CONFIGURED',
        }),
      };
      const audit = auditSpy();
      const controller = new CopyBudgetAdminController(budgets as never, audit as never);

      await controller.setDefaultCaps(
        { userId: USER_ID } as never,
        TENANT_ID,
        { maxActiveExposure: '500.25', perTraderCap: '100.05', currency: 'USDT' } as never,
        { requestId: 'req-9', ipHash: 'ip-hash-9' } as never,
      );

      expect(audit.record).toHaveBeenCalledTimes(1);
      const entry = audit.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        tenantId: TENANT_ID,
        actorId: USER_ID,
        action: 'TENANT_SETTING_UPDATED',
        outcome: 'SUCCESS',
        resourceType: 'copy_budget_tenant_ceiling',
        requestId: 'req-9',
        ipHash: 'ip-hash-9',
      });
      expect(entry.metadata.previous).toEqual({ amount: '1000.00', currency: 'USDT', status: 'CONFIGURED' });
      expect(entry.metadata.next).toEqual({ amount: '500.25', perTraderCap: '100.05', currency: 'USDT' });
      // The description is what an auditor reads first; it must name the setting.
      expect(entry.description).toContain('tenant ceiling');
    });

    it('writes no audit event when the service refuses the change', async () => {
      const budgets = {
        getTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: '10.00', currency: 'USDT', updatedAt: null, status: 'CONFIGURED' }),
        setTenantDefaultCaps: jest.fn().mockRejectedValue(new Error('perTraderCap must not exceed maxActiveExposure')),
      };
      const audit = auditSpy();
      const controller = new CopyBudgetAdminController(budgets as never, audit as never);

      await expect(
        controller.setDefaultCaps(
          { userId: USER_ID } as never,
          TENANT_ID,
          { maxActiveExposure: '10.00', perTraderCap: '11.00', currency: 'USDT' } as never,
          { requestId: 'req-2', ipHash: 'ip-hash-2' } as never,
        ),
      ).rejects.toThrow('perTraderCap must not exceed maxActiveExposure');
      // A refusal recorded as SUCCESS would be worse than no record at all.
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('input handling', () => {
    it('passes decimal strings through unchanged rather than converting them to numbers', async () => {
      const budgets = {
        getTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: null, currency: null, updatedAt: null, status: 'NOT_CONFIGURED' }),
        // 0.1 + 0.2 is 0.30000000000000004 in float arithmetic; a string amount
        // that survives this call unchanged proves no float ever touched it.
        setTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: '0.30', currency: 'USDT', updatedAt: null, status: 'CONFIGURED' }),
      };
      const controller = new CopyBudgetAdminController(budgets as never, auditSpy() as never);

      await controller.setDefaultCaps(
        { userId: USER_ID } as never,
        TENANT_ID,
        { maxActiveExposure: '0.30', currency: 'USDT' } as never,
        { requestId: 'req-3', ipHash: 'ip-hash-3' } as never,
      );

      expect(budgets.setTenantDefaultCaps).toHaveBeenCalledWith(
        expect.objectContaining({ maxActiveExposure: '0.30' }),
      );
      expect(typeof budgets.setTenantDefaultCaps.mock.calls[0][0].maxActiveExposure).toBe('string');
    });

    it('passes an omitted per-trader cap as null, never as an empty string', async () => {
      const budgets = {
        getTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: null, currency: null, updatedAt: null, status: 'NOT_CONFIGURED' }),
        setTenantDefaultCaps: jest.fn().mockResolvedValue({ maxActiveExposure: '10.00', currency: 'USDT', updatedAt: null, status: 'CONFIGURED' }),
      };
      const controller = new CopyBudgetAdminController(budgets as never, auditSpy() as never);

      await controller.setDefaultCaps(
        { userId: USER_ID } as never,
        TENANT_ID,
        { maxActiveExposure: '10.00', currency: 'USDT' } as never,
        { requestId: 'req-4', ipHash: 'ip-hash-4' } as never,
      );

      expect(budgets.setTenantDefaultCaps.mock.calls[0][0].perTraderCap).toBeNull();
    });

    it('forwards the pagination and threshold the operator asked for', async () => {
      const budgets = { listOverCapUsers: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
      const controller = new CopyBudgetAdminController(budgets as never, auditSpy() as never);

      await controller.listOverCapUsers(TENANT_ID, { page: 3, limit: 50, utilisationBps: 8_000, status: 'NEAR' });

      expect(budgets.listOverCapUsers).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        page: 3,
        limit: 50,
        utilisationBps: 8_000,
        status: 'NEAR',
      });
    });

    it('returns the page total alongside the rows, so a partial page is visible as partial', async () => {
      const rows = [
        { userId: 'u1', state: 'OVER', utilisationBps: 12_500 },
        { userId: 'u2', state: 'NEAR', utilisationBps: 9_400 },
      ];
      const budgets = { listOverCapUsers: jest.fn().mockResolvedValue({ data: rows, total: 17 }) };
      const controller = new CopyBudgetAdminController(budgets as never, auditSpy() as never);

      await expect(controller.listOverCapUsers(TENANT_ID, {})).resolves.toEqual({ data: rows, total: 17 });
    });
  });
});

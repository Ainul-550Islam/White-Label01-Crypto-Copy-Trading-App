import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RiskManagementController } from './risk.controller';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { RiskPolicyScopeDto, type UpsertRiskPolicyDto } from './dto/risk-policy.dto';

const tenant = 'tenant-a', foreign = 'tenant-b', user = 'user-a';
const dto = (scope: RiskPolicyScopeDto, tenantId?: string, scopeId?: string): UpsertRiskPolicyDto => ({
  scope, tenantId, scopeId, expectedVersion: null, thresholds: { maxOrderNotional: '5' }, changeReason: 'Update policy for testing',
});
function setup() {
  const controller = Object.create(RiskManagementController.prototype) as RiskManagementController;
  const policyService = { upsertPolicy: jest.fn(async () => ({ id: 'policy-id', version: 1, digest: 'digest' })) };
  Reflect.set(controller, 'policyService', policyService);
  return { controller, policyService };
}
const actor = { headers: { 'idempotency-key': 'policy-retry-key' },
  user: { tenantId: tenant, userId: user, roles: [], permissions: [Permission.RISK_CONFIG_UPDATE], isPlatformUser: false } };

describe('institutional risk policy tenant and platform scope', () => {
  it('requires its own step-up action, retry key and observed version', async () => {
    expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, RiskManagementController.prototype.upsertPolicy)).toBe('INSTITUTIONAL_RISK_POLICY_UPDATE');
    const h = setup();
    await expect(h.controller.upsertPolicy({ ...actor, headers: {} }, dto(RiskPolicyScopeDto.TENANT))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.controller.upsertPolicy(actor, { ...dto(RiskPolicyScopeDto.TENANT), expectedVersion: undefined } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.policyService.upsertPolicy).not.toHaveBeenCalled();
  });
  it.each([RiskPolicyScopeDto.TENANT, RiskPolicyScopeDto.TRADER, RiskPolicyScopeDto.STRATEGY, RiskPolicyScopeDto.FOLLOWER])(
    'rejects a foreign tenant for %s even with a forged platform role label', async (scope) => {
      const h = setup();
      const forged = { ...actor, user: { ...actor.user, roles: ['PLATFORM_ADMIN'], permissions: ['PLATFORM_MANAGE'] } };
      await expect(h.controller.upsertPolicy(forged, dto(scope, foreign, 'scope-a'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.policyService.upsertPolicy).not.toHaveBeenCalled();
    },
  );
  it('does not treat platform-looking tenant permissions as platform identity', async () => {
    const h = setup();
    const forged = { ...actor, user: { ...actor.user, permissions: ['PLATFORM_MANAGE', Permission.PLATFORM_MANAGE] } };
    await expect(h.controller.upsertPolicy(forged, dto(RiskPolicyScopeDto.PLATFORM))).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.policyService.upsertPolicy).not.toHaveBeenCalled();
  });
  it('requires a real platform principal and the platform permission for a global policy', async () => {
    const h = setup();
    await expect(h.controller.upsertPolicy({ ...actor, user: { ...actor.user, isPlatformUser: true } }, dto(RiskPolicyScopeDto.PLATFORM)))
      .rejects.toBeInstanceOf(ForbiddenException);
    const platform = { ...actor, user: { ...actor.user, isPlatformUser: true, permissions: [Permission.RISK_CONFIG_UPDATE, Permission.PLATFORM_MANAGE] } };
    await h.controller.upsertPolicy(platform, dto(RiskPolicyScopeDto.PLATFORM));
    expect(h.policyService.upsertPolicy).toHaveBeenCalledWith(expect.objectContaining({ scope: 'PLATFORM', tenantId: null, changedByUserId: user }));
  });
  it('requires the tenant scope id to match the authenticated target tenant', async () => {
    const h = setup();
    await expect(h.controller.upsertPolicy(actor, dto(RiskPolicyScopeDto.TENANT, tenant, foreign))).rejects.toBeInstanceOf(BadRequestException);
    await h.controller.upsertPolicy(actor, dto(RiskPolicyScopeDto.TENANT));
    expect(h.policyService.upsertPolicy).toHaveBeenCalledWith(expect.objectContaining({ scope: 'TENANT', tenantId: tenant, scopeId: tenant }));
  });
  it('requires an authenticated user instead of writing a system identity', async () => {
    const h = setup();
    await expect(h.controller.upsertPolicy({ user: { tenantId: tenant } }, dto(RiskPolicyScopeDto.TENANT))).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.policyService.upsertPolicy).not.toHaveBeenCalled();
  });
});

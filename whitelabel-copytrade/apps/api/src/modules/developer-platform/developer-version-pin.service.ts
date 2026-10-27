import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApiVersionService } from './api-version.service';
import { DeveloperAuditService } from './developer-audit.service';
import type { DeveloperActor } from './developer-application.service';
import { claimMutationIntent } from './developer-mutation-intent';
import { DEVELOPER_POLICY_DATA_PORT, DeveloperPolicyDataPort, DeveloperPolicyService } from './developer-policy.service';
import { DEVELOPER_ERROR_CODES, DeveloperError } from './developer.types';

type PinRow = { version: string; state: string };

@Injectable()
export class DeveloperVersionPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly versions: ApiVersionService,
    private readonly policy: DeveloperPolicyService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
  ) {}

  async get(tenantId: string, applicationId: string): Promise<{ applicationId: string; version: string }> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<PinRow[]>`
        SELECT pinned_api_version AS version, state FROM developer_applications
        WHERE tenant_id = ${tenantId}::uuid AND id = ${applicationId}::uuid`;
      if (!rows[0]) throw new NotFoundException('application not found');
      return { applicationId, version: rows[0].version };
    });
  }

  async set(actor: DeveloperActor, applicationId: string, version: string, key: string): Promise<{ applicationId: string; version: string }> {
    const resolution = this.versions.resolve({ pathVersion: version, nowIso: new Date().toISOString() });
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const allowed = this.policy.resolve(actor.tenantId, plan, entitlements).allowedApiVersions;
    this.versions.assertVersionAllowed(resolution.contract.version, allowed);
    return this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      const rows = await tx.$queryRaw<PinRow[]>`
        SELECT pinned_api_version AS version, state FROM developer_applications
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${applicationId}::uuid FOR UPDATE`;
      const prior = rows[0];
      if (!prior) throw new NotFoundException('application not found');
      if (prior.state === 'REVOKED') {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
      }
      await claimMutationIntent(tx, actor.tenantId, key, 'application.version_pin', applicationId);
      await tx.$executeRaw`
        UPDATE developer_applications SET pinned_api_version = ${version}, updated_at = now()
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${applicationId}::uuid`;
      await this.audit.record({
        ...actor, applicationId, action: 'application.version_pinned',
        detail: { previousVersion: prior.version, version },
      }, tx);
      return { applicationId, version };
    });
  }
}

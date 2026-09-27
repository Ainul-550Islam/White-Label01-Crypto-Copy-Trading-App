import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientProfileRepository } from './client-profile.repository';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { CLIENT_PROFILE_VALID_TRANSITIONS, ClientProfileStatus, redactPiiAndSecrets } from './client-lifecycle.types';

/**
 * Creates and maintains normalized institutional/client profiles, preserving tenant ownership,
 * external identity references, profile status, and immutable lifecycle history without duplicating KYC truth.
 */

@Injectable()
export class ClientProfileService {
  private readonly logger = new Logger(ClientProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileRepo: ClientProfileRepository,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async createProfile(params: {
    tenantId: string;
    clientType?: string;
    legalName?: string | null;
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    countryCode?: string | null;
    externalIdentityRef?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const profile = await this.profileRepo.createProfile({
      tenantId: params.tenantId,
      clientType: params.clientType,
      legalName: params.legalName,
      displayName: params.displayName,
      email: params.email,
      phone: params.phone,
      countryCode: params.countryCode,
      externalIdentityRef: params.externalIdentityRef,
    });

    await this.auditService.log({
      tenantId: params.tenantId,
      clientProfileId: profile.id,
      action: 'CLIENT_PROFILE_CREATED',
      entityType: 'CLIENT_PROFILE',
      entityId: profile.id,
      actorId: params.operatorId ?? null,
      toState: 'PENDING',
      correlationId: params.correlationId ?? null,
      evidence: redactPiiAndSecrets({ clientType: params.clientType, externalIdentityRef: params.externalIdentityRef }) as any,
    });

    return profile;
  }

  async transitionProfile(params: {
    tenantId: string;
    profileId: string;
    toStatus: ClientProfileStatus;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, toStatus, operatorId = null, reason, correlationId = null } = params;

    const profile = await this.profileRepo.getProfile({ tenantId, profileId });
    if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');

    const currentStatus = profile.status as ClientProfileStatus;

    // All sensitive lifecycle transitions must be state-machine validated
    const allowed = CLIENT_PROFILE_VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new BadRequestException(`Invalid client profile transition ${currentStatus} → ${toStatus}`);
    }

    const updated = await (this.prisma as any).clientProfile.update({
      where: { id: profileId },
      data: { status: toStatus as any },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: profileId,
      action: 'CLIENT_PROFILE_STATUS_CHANGED',
      entityType: 'CLIENT_PROFILE',
      entityId: profileId,
      actorId: operatorId,
      fromState: currentStatus,
      toState: toStatus,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentStatus, toState: toStatus, reason },
    });

    this.logger.log({ event: 'client.profile.transition', profileId, from: currentStatus, to: toStatus });

    return updated;
  }

  async getProfile(params: { tenantId: string; profileId: string }): Promise<any | null> {
    return await this.profileRepo.getProfile(params);
  }

  async listProfiles(params: {
    tenantId: string;
    status?: string;
    clientType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    return await this.profileRepo.listProfiles(params);
  }
}

import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientProfileRepository } from './client-profile.repository';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, ClientOnboardingState, redactPiiAndSecrets } from './client-lifecycle.types';

/**
 * Orchestrates the client onboarding workflow from registration/request through required
 * identity/compliance/security checks and approval. Must delegate KYC/AML truth to ComplianceModule.
 */

@Injectable()
export class ClientOnboardingService {
  private readonly logger = new Logger(ClientOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileRepo: ClientProfileRepository,
    private readonly workflowService: OnboardingWorkflowService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async initiateOnboarding(params: {
    tenantId: string;
    clientProfileId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, clientProfileId, operatorId = null, correlationId = null } = params;

    const profile = await this.profileRepo.getProfile({ tenantId, profileId: clientProfileId });
    if (!profile) throw new BadRequestException('Client profile not found');

    // Check existing onboarding
    try {
      const existing = await (this.prisma as any).clientOnboarding.findFirst({
        where: { tenantId, clientProfileId, state: { in: ['NOT_STARTED', 'IN_PROGRESS', 'PENDING_REVIEW'] } },
      });
      if (existing) return existing;
    } catch {}

    const idempotencyKey = deterministicIdempotencyKey({
      type: 'client-onboarding',
      tenantId,
      clientProfileId,
      externalRef: clientProfileId,
    });

    try {
      const existingByKey = await (this.prisma as any).clientOnboarding.findFirst({ where: { idempotencyKey } });
      if (existingByKey) return existingByKey;
    } catch {}

    const onboarding = await (this.prisma as any).clientOnboarding.create({
      data: {
        tenantId,
        clientProfileId,
        state: 'IN_PROGRESS',
        requiredSteps: [
          'PROFILE_CREATED',
          'IDENTITY_REQUIRED',
          'KYC_PENDING',
          'AML_PENDING',
          'SECURITY_SETUP_REQUIRED',
          'COMPLIANCE_REVIEW',
          'RISK_REVIEW',
          'ACCOUNT_CONFIGURATION',
          'APPROVAL',
          'ACTIVATION_ELIGIBILITY',
        ],
        completedSteps: ['PROFILE_CREATED'],
        initiatedBy: operatorId,
        idempotencyKey,
        startedAt: new Date(),
      },
    });

    // Create steps
    await this.workflowService.initializeSteps({ tenantId, onboardingId: onboarding.id });

    await this.auditService.log({
      tenantId,
      clientProfileId,
      action: 'ONBOARDING_INITIATED',
      entityType: 'CLIENT_ONBOARDING',
      entityId: onboarding.id,
      actorId: operatorId,
      toState: 'IN_PROGRESS',
      correlationId,
      evidence: { clientProfileId, onboardingId: onboarding.id },
    });

    // Transition client profile to ONBOARDING
    try {
      await (this.prisma as any).clientProfile.update({
        where: { id: clientProfileId },
        data: { status: 'ONBOARDING', onboardingId: onboarding.id },
      });
    } catch {}

    return onboarding;
  }

  async getOnboarding(params: { tenantId: string; onboardingId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).clientOnboarding.findFirst({
        where: { id: params.onboardingId, tenantId: params.tenantId },
        include: { steps: true },
      });
    } catch {
      return null;
    }
  }

  async getOnboardingByClientProfile(params: { tenantId: string; clientProfileId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).clientOnboarding.findFirst({
        where: { tenantId: params.tenantId, clientProfileId: params.clientProfileId },
        orderBy: { createdAt: 'desc' },
        include: { steps: true },
      });
    } catch {
      return null;
    }
  }

  async approveOnboarding(params: {
    tenantId: string;
    onboardingId: string;
    operatorId: string;
    isSelfApproval?: boolean;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, onboardingId, operatorId, isSelfApproval = false, correlationId = null } = params;

    // Never allow a client to self-approve a privileged workflow
    if (isSelfApproval) {
      throw new ForbiddenException('Client cannot self-approve onboarding — privileged workflow requires operator');
    }

    const onboarding = await this.getOnboarding({ tenantId, onboardingId });
    if (!onboarding) throw new BadRequestException('Onboarding not found');

    // Delegate KYC/AML truth to ComplianceModule — check compliance state from authoritative service
    // For now, verify steps are completed via workflow service
    const workflowStatus = await this.workflowService.getWorkflowStatus({ tenantId, onboardingId });

    if (!workflowStatus.canApprove) {
      throw new BadRequestException(`Onboarding cannot be approved — blocking: ${workflowStatus.blockingReasons.join(',')}`);
    }

    // Transition to APPROVED via workflow service
    const approved = await this.workflowService.transitionOnboarding({
      tenantId,
      onboardingId,
      toState: ClientOnboardingState.APPROVED as any,
      operatorId,
      correlationId,
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: onboarding.clientProfileId,
      action: 'ONBOARDING_APPROVED',
      entityType: 'CLIENT_ONBOARDING',
      entityId: onboardingId,
      actorId: operatorId,
      fromState: onboarding.state,
      toState: 'APPROVED',
      correlationId,
      evidence: { onboardingId, approvedBy: operatorId },
    });

    // Transition client profile to APPROVED
    try {
      await (this.prisma as any).clientProfile.update({
        where: { id: onboarding.clientProfileId },
        data: { status: 'APPROVED' },
      });
    } catch {}

    return approved;
  }

  async rejectOnboarding(params: {
    tenantId: string;
    onboardingId: string;
    operatorId: string;
    reason: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, onboardingId, operatorId, reason, correlationId = null } = params;

    const onboarding = await this.getOnboarding({ tenantId, onboardingId });
    if (!onboarding) throw new BadRequestException('Onboarding not found');

    const rejected = await this.workflowService.transitionOnboarding({
      tenantId,
      onboardingId,
      toState: ClientOnboardingState.REJECTED as any,
      operatorId,
      reason,
      correlationId,
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: onboarding.clientProfileId,
      action: 'ONBOARDING_REJECTED',
      entityType: 'CLIENT_ONBOARDING',
      entityId: onboardingId,
      actorId: operatorId,
      fromState: onboarding.state,
      toState: 'REJECTED',
      reason,
      correlationId,
      evidence: { reason },
    });

    return rejected;
  }
}

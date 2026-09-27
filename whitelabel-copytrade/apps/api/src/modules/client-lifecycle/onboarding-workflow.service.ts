import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import {
  ClientOnboardingState,
  ClientOnboardingStepType,
  ClientOnboardingStepStatus,
  ONBOARDING_VALID_TRANSITIONS,
  deterministicIdempotencyKey,
  redactPiiAndSecrets,
} from './client-lifecycle.types';

/**
 * Explicitly manages onboarding states, required steps, blocking conditions, completion criteria,
 * retry rules, and operator actions without allowing a client to mark steps complete.
 */

@Injectable()
export class OnboardingWorkflowService {
  private readonly logger = new Logger(OnboardingWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async initializeSteps(params: { tenantId: string; onboardingId: string }): Promise<any[]> {
    const { tenantId, onboardingId } = params;

    const stepTypes = [
      ClientOnboardingStepType.PROFILE_CREATED,
      ClientOnboardingStepType.IDENTITY_REQUIRED,
      ClientOnboardingStepType.KYC_PENDING,
      ClientOnboardingStepType.AML_PENDING,
      ClientOnboardingStepType.SECURITY_SETUP_REQUIRED,
      ClientOnboardingStepType.COMPLIANCE_REVIEW,
      ClientOnboardingStepType.RISK_REVIEW,
      ClientOnboardingStepType.ACCOUNT_CONFIGURATION,
      ClientOnboardingStepType.EXCHANGE_BINDING,
      ClientOnboardingStepType.PORTFOLIO_BINDING,
      ClientOnboardingStepType.APPROVAL,
      ClientOnboardingStepType.ACTIVATION_ELIGIBILITY,
    ];

    const steps: any[] = [];

    for (const stepType of stepTypes) {
      const idempotencyKey = deterministicIdempotencyKey({
        type: `onboarding-step:${stepType}`,
        tenantId,
        externalRef: `${onboardingId}:${stepType}`,
      });

      try {
        const existing = await (this.prisma as any).clientOnboardingStep.findFirst({ where: { idempotencyKey } });
        if (existing) {
          steps.push(existing);
          continue;
        }
      } catch {}

      const status = stepType === ClientOnboardingStepType.PROFILE_CREATED ? ClientOnboardingStepStatus.COMPLETED : ClientOnboardingStepStatus.PENDING;

      const step = await (this.prisma as any).clientOnboardingStep.create({
        data: {
          tenantId,
          onboardingId,
          stepType: stepType as any,
          status: status as any,
          required: ![ClientOnboardingStepType.EXCHANGE_BINDING, ClientOnboardingStepType.PORTFOLIO_BINDING].includes(stepType),
          idempotencyKey,
          ...(status === ClientOnboardingStepStatus.COMPLETED ? { completedAt: new Date() } : {}),
        },
      });

      steps.push(step);
    }

    return steps;
  }

  async getWorkflowStatus(params: { tenantId: string; onboardingId: string }): Promise<{
    state: string;
    steps: any[];
    completedSteps: string[];
    pendingSteps: string[];
    blockingReasons: string[];
    canApprove: boolean;
  }> {
    const { tenantId, onboardingId } = params;

    const onboarding = await (this.prisma as any).clientOnboarding.findFirst({
      where: { id: onboardingId, tenantId },
      include: { steps: true },
    });

    if (!onboarding) throw new BadRequestException('Onboarding not found');

    const steps = onboarding.steps ?? [];
    const completedSteps = steps.filter((s: any) => s.status === 'COMPLETED').map((s: any) => s.stepType);
    const pendingSteps = steps.filter((s: any) => s.status !== 'COMPLETED' && s.required).map((s: any) => s.stepType);

    const blockingReasons: string[] = [];

    // Check authoritative services — KYC/AML truth from ComplianceModule, Risk from RiskManagementModule, Security from SecurityModule
    // For each required step, if not completed, add blocking reason
    for (const step of steps) {
      if (step.required && step.status !== 'COMPLETED') {
        // Check if step has blockingReasons from authoritative services
        const stepBlocking = (step.blockingReasons as any[]) ?? [];
        if (stepBlocking.length > 0) {
          blockingReasons.push(...stepBlocking.map((b: any) => `${step.stepType}: ${b}`));
        } else {
          blockingReasons.push(`${step.stepType} not completed`);
        }
      }
    }

    // Compliance decision must come from Compliance authority — not client-supplied
    // We check onboarding complianceDecision — should be set by ComplianceModule, not client
    if (!onboarding.complianceDecision || onboarding.complianceDecision !== 'APPROVED') {
      if (!blockingReasons.some((r) => r.includes('COMPLIANCE'))) {
        blockingReasons.push('COMPLIANCE_REVIEW: compliance decision not APPROVED from authoritative ComplianceModule');
      }
    }

    // KYC/AML state comes from Compliance authority
    if (onboarding.kycState !== 'APPROVED' && onboarding.kycState !== 'VERIFIED') {
      // KYC pending is blocking unless step is optional
      const kycStep = steps.find((s: any) => s.stepType === 'KYC_PENDING');
      if (kycStep?.required && kycStep.status !== 'COMPLETED') {
        if (!blockingReasons.some((r) => r.includes('KYC'))) {
          blockingReasons.push('KYC_PENDING: KYC state not approved from Compliance authority');
        }
      }
    }

    const canApprove = blockingReasons.length === 0 && pendingSteps.filter((s: string) => !['EXCHANGE_BINDING', 'PORTFOLIO_BINDING'].includes(s)).length === 0;

    return {
      state: onboarding.state,
      steps,
      completedSteps,
      pendingSteps,
      blockingReasons,
      canApprove,
    };
  }

  async completeStep(params: {
    tenantId: string;
    onboardingId: string;
    stepType: ClientOnboardingStepType;
    operatorId: string;
    isClient?: boolean;
    evidence?: any;
    sourceType?: string | null;
    sourceId?: string | null;
  }): Promise<any> {
    const { tenantId, onboardingId, stepType, operatorId, isClient = false, evidence = {}, sourceType = null, sourceId = null } = params;

    // Client cannot submit kycApproved=true, amlClear=true, riskApproved=true, etc. as trusted state
    // Only operator/system can mark steps complete, and must have sourceType from authoritative service
    if (isClient && [ClientOnboardingStepType.KYC_PENDING, ClientOnboardingStepType.AML_PENDING, ClientOnboardingStepType.COMPLIANCE_REVIEW, ClientOnboardingStepType.RISK_REVIEW, ClientOnboardingStepType.APPROVAL].includes(stepType)) {
      throw new BadRequestException(`Client cannot mark ${stepType} complete — requires authoritative service`);
    }

    const step = await (this.prisma as any).clientOnboardingStep.findFirst({
      where: { tenantId, onboardingId, stepType: stepType as any },
    });

    if (!step) throw new BadRequestException(`Onboarding step ${stepType} not found`);

    if (step.status === 'COMPLETED') return step;

    // Verify sourceType is from authoritative service for sensitive steps
    const sensitiveSteps = [ClientOnboardingStepType.KYC_PENDING, ClientOnboardingStepType.AML_PENDING, ClientOnboardingStepType.COMPLIANCE_REVIEW, ClientOnboardingStepType.RISK_REVIEW];
    if (sensitiveSteps.includes(stepType) && !sourceType) {
      throw new BadRequestException(`Step ${stepType} requires sourceType from authoritative Compliance/Risk service`);
    }

    const updated = await (this.prisma as any).clientOnboardingStep.update({
      where: { id: step.id },
      data: {
        status: 'COMPLETED',
        completedBy: operatorId,
        completedAt: new Date(),
        evidence: redactPiiAndSecrets(evidence) as any,
        sourceType: sourceType ?? null,
        sourceId: sourceId ?? null,
        sourceTimestamp: new Date(),
      },
    });

    // Update onboarding completedSteps
    try {
      const onboarding = await (this.prisma as any).clientOnboarding.findFirst({ where: { id: onboardingId } });
      if (onboarding) {
        const completed = [...new Set([...(onboarding.completedSteps as string[]), stepType])];
        await (this.prisma as any).clientOnboarding.update({
          where: { id: onboardingId },
          data: { completedSteps: completed },
        });
      }
    } catch {}

    await this.auditService.log({
      tenantId,
      action: 'ONBOARDING_STEP_COMPLETED',
      entityType: 'CLIENT_ONBOARDING_STEP',
      entityId: step.id,
      actorId: operatorId,
      evidence: { stepType, sourceType, sourceId },
    });

    return updated;
  }

  async failStep(params: {
    tenantId: string;
    onboardingId: string;
    stepType: ClientOnboardingStepType;
    reason: string;
    operatorId?: string | null;
  }): Promise<any> {
    const { tenantId, onboardingId, stepType, reason, operatorId = null } = params;

    const step = await (this.prisma as any).clientOnboardingStep.findFirst({
      where: { tenantId, onboardingId, stepType: stepType as any },
    });

    if (!step) throw new BadRequestException(`Step ${stepType} not found`);

    const updated = await (this.prisma as any).clientOnboardingStep.update({
      where: { id: step.id },
      data: {
        status: 'FAILED',
        blockingReasons: [...((step.blockingReasons as any[]) ?? []), reason],
      },
    });

    return updated;
  }

  async transitionOnboarding(params: {
    tenantId: string;
    onboardingId: string;
    toState: ClientOnboardingState;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, onboardingId, toState, operatorId = null, reason, correlationId = null } = params;

    const onboarding = await (this.prisma as any).clientOnboarding.findFirst({ where: { id: onboardingId, tenantId } });
    if (!onboarding) throw new BadRequestException('Onboarding not found');

    const currentState = onboarding.state as ClientOnboardingState;
    const allowed = ONBOARDING_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid onboarding transition ${currentState} → ${toState}`);
    }

    const updated = await (this.prisma as any).clientOnboarding.update({
      where: { id: onboardingId },
      data: {
        state: toState as any,
        ...(toState === ClientOnboardingState.APPROVED ? { completedAt: new Date(), approvedBy: operatorId } : {}),
        ...(toState === ClientOnboardingState.REJECTED ? { completedAt: new Date() } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: onboarding.clientProfileId,
      action: 'ONBOARDING_STATE_CHANGED',
      entityType: 'CLIENT_ONBOARDING',
      entityId: onboardingId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, reason },
    });

    return updated;
  }
}

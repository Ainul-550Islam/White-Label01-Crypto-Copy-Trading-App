import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { ClientPolicyService } from './client-policy.service';
import { ClientProfileRepository } from './client-profile.repository';
import { ClientProfileService } from './client-profile.service';
import { ClientOnboardingService } from './client-onboarding.service';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { AccountAdministrationService } from './account-administration.service';
import { AccountStateService } from './account-state.service';
import { AccountOwnershipService } from './account-ownership.service';
import { AccountPermissionService } from './account-permission.service';
import { TradingActivationService } from './trading-activation.service';
import { AccountRestrictionService } from './account-restriction.service';
import { AccountSuspensionService } from './account-suspension.service';
import { AccountClosureService } from './account-closure.service';
import { ExchangeAccountBindingService } from './exchange-account-binding.service';
import { PortfolioBindingService } from './portfolio-binding.service';
import { FundingRequestService } from './funding-request.service';
import { WithdrawalRequestService } from './withdrawal-request.service';
import { FundingApprovalService } from './funding-approval.service';
import { FundingReconciliationService } from './funding-reconciliation.service';
import { AccountReviewService } from './account-review.service';
import { RelationshipService } from './relationship.service';
import { LifecycleNotificationService } from './lifecycle-notification.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { LifecycleReconciliationService } from './lifecycle-reconciliation.service';
import { ClientVisibilityService } from './client-visibility.service';
import { ClientLifecycleController } from './client-lifecycle.controller';

/**
 * Part 20 — Institutional Client Lifecycle, Account Administration & Funding Control Plane
 *
 * Final chain:
 * Tenant → Client/Investor → Onboarding → KYC/AML/Security/Compliance → Institutional Account →
 * Ownership/Relationships → Exchange Account + Portfolio Binding → Risk + Trading Eligibility →
 * Live Gate → Copy Trading/Strategy → OMS → Execution → Exchange → Fills/Positions/Balances →
 * Fees/Finance → Portfolio Accounting → NAV/PnL/Performance/Attribution → Statements/Reporting →
 * Funding/Withdrawal Workflows → Reconciliation → Operations Control Plane → Immutable Audit
 *
 * Rules:
 * - Never use fake approvals, fake funding success, fake withdrawal success, fake balances, fabricated compliance
 * - Never directly mutate exchange balances, never create successful payment settlement, never bypass Compliance/Risk/Operations/OMS/live-mode
 * - Never activate LIVE trading without required controls, never allow client self-approve privileged workflow
 * - Never trust client-supplied account state, approval state, compliance state, risk state, balance, funding status, ownership
 * - All sensitive transitions state-machine validated, privileged transitions authorized by IAM/RBAC
 * - All ownership changes audited, funding/withdrawal idempotent, workflow records not proof of movement
 * - External payment/custody/exchange authoritative for settlement, pending never reported as completed
 * - Rejected/blocked never silently retried into success, corrections preserve history
 * - Tenant isolation mandatory, platform RBAC for platform admin, PII redacted, reuse existing policies
 */

@Module({
  controllers: [ClientLifecycleController],
  providers: [
    PrismaService,
    AppConfigService,
    ClientPolicyService,
    ClientProfileRepository,
    ClientProfileService,
    ClientOnboardingService,
    OnboardingWorkflowService,
    AccountAdministrationService,
    AccountStateService,
    AccountOwnershipService,
    AccountPermissionService,
    TradingActivationService,
    AccountRestrictionService,
    AccountSuspensionService,
    AccountClosureService,
    ExchangeAccountBindingService,
    PortfolioBindingService,
    FundingRequestService,
    WithdrawalRequestService,
    FundingApprovalService,
    FundingReconciliationService,
    AccountReviewService,
    RelationshipService,
    LifecycleNotificationService,
    LifecycleAuditService,
    LifecycleReconciliationService,
    ClientVisibilityService,
  ],
  exports: [
    ClientPolicyService,
    ClientProfileRepository,
    ClientProfileService,
    ClientOnboardingService,
    OnboardingWorkflowService,
    AccountAdministrationService,
    AccountStateService,
    AccountOwnershipService,
    AccountPermissionService,
    TradingActivationService,
    AccountRestrictionService,
    AccountSuspensionService,
    AccountClosureService,
    ExchangeAccountBindingService,
    PortfolioBindingService,
    FundingRequestService,
    WithdrawalRequestService,
    FundingApprovalService,
    FundingReconciliationService,
    AccountReviewService,
    RelationshipService,
    LifecycleNotificationService,
    LifecycleAuditService,
    LifecycleReconciliationService,
    ClientVisibilityService,
  ],
})
export class ClientLifecycleModule {}

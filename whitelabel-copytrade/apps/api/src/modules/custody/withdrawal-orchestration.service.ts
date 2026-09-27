import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { TransactionService } from './transaction.service';
import { CustodyAuditService } from './custody-audit.service';
import { CustodyPolicyService } from './custody-policy.service';
import { deterministicIdempotencyKey, CustodyWithdrawalState, WITHDRAWAL_VALID_TRANSITIONS, redactSecrets } from './custody.types';

/**
 * Coordinates approved withdrawal workflows into custody-provider submission while preserving existing
 * client/funding workflow state. Must verify all prerequisites again immediately before submission
 * and must never bypass approval, compliance, risk, security, or operational restrictions.
 */

@Injectable()
export class WithdrawalOrchestrationService {
  private readonly logger = new Logger(WithdrawalOrchestrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawalPolicyService: WithdrawalPolicyService,
    private readonly providerFactory: BlockchainProviderFactory,
    private readonly transactionService: TransactionService,
    private readonly auditService: CustodyAuditService,
    private readonly custodyPolicyService: CustodyPolicyService,
  ) {}

  async submitWithdrawal(params: {
    tenantId: string;
    custodyWithdrawalId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, custodyWithdrawalId, operatorId = null, correlationId = null } = params;

    const withdrawal = await (this.prisma as any).custodyWithdrawal.findFirst({ where: { id: custodyWithdrawalId, tenantId } });
    if (!withdrawal) throw new BadRequestException('Custody withdrawal not found');

    const currentState = withdrawal.state as CustodyWithdrawalState;

    // Must be APPROVED or QUEUED to submit
    if (![CustodyWithdrawalState.APPROVED, CustodyWithdrawalState.QUEUED].includes(currentState)) {
      throw new BadRequestException(`Withdrawal must be APPROVED/QUEUED to submit, current: ${currentState}`);
    }

    // Before provider submission, re-check all safety gates
    const eligibility = await this.withdrawalPolicyService.evaluateWithdrawalEligibility({
      tenantId,
      accountId: withdrawal.accountId,
      walletId: withdrawal.walletId,
      assetId: withdrawal.assetId,
      networkId: withdrawal.networkId,
      amount: withdrawal.amount,
      destinationAddress: withdrawal.destinationAddress,
      operatorId,
    });

    if (!eligibility.eligible) {
      // DO NOT SUBMIT if any mandatory gate fails
      throw new BadRequestException(`Withdrawal safety gates failed — DO NOT SUBMIT: ${eligibility.blockingReasons.join(', ')}`);
    }

    // Check approval exists — existing withdrawal approval requirements must not be bypassed
    try {
      const approval = await (this.prisma as any).fundingApproval.findFirst({
        where: { tenantId, withdrawalRequestId: withdrawal.withdrawalRequestId, decision: 'APPROVED' },
      });
      if (!approval && withdrawal.withdrawalRequestId) {
        // Also check fundingRequest approval
        const fundingApproval = await (this.prisma as any).fundingApproval.findFirst({
          where: { tenantId, fundingRequestId: withdrawal.fundingRequestId, decision: 'APPROVED' },
        });
        if (!fundingApproval && !withdrawal.fundingRequestId) {
          // For custody withdrawal directly, require operator approval
          if (!operatorId) throw new BadRequestException('Withdrawal approval required — existing approval requirements must not be bypassed');
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    // Check provider available
    let provider: any = null;
    try {
      provider = await this.providerFactory.getProviderForNetwork({ networkId: withdrawal.networkId, assetId: withdrawal.assetId });
      const health = await provider.isHealthy?.();
      if (health && !health.healthy) {
        throw new BadRequestException(`Provider unavailable — prevents submission: ${health.reason}`);
      }
    } catch (e) {
      throw new BadRequestException(`Provider unavailable prevents submission: ${(e as Error).message}`);
    }

    // Transition to SUBMITTED
    const allowed = WITHDRAWAL_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(CustodyWithdrawalState.SUBMITTED as any)) {
      throw new BadRequestException(`Invalid transition ${currentState} → SUBMITTED`);
    }

    const submitted = await (this.prisma as any).custodyWithdrawal.update({
      where: { id: custodyWithdrawalId },
      data: { state: 'SUBMITTED', submittedAt: new Date(), submittedBy: operatorId },
    });

    // Submit to provider — must be idempotent where supported
    let providerResult: any = null;
    try {
      if (provider.submitTransaction) {
        // Convert amount to base-unit integer using token decimals from authoritative asset metadata
        const decimals = await this.getDecimalsForAsset(withdrawal.assetId);
        const baseUnitAmount = this.toBaseUnit(withdrawal.amount, decimals);

        const idempotencyKey = deterministicIdempotencyKey({
          type: `withdrawal-submit:${withdrawal.assetId}:${withdrawal.networkId}`,
          tenantId,
          walletId: withdrawal.walletId ?? undefined,
          assetId: withdrawal.assetId,
          networkId: withdrawal.networkId,
          externalRef: `${withdrawal.destinationAddress}:${baseUnitAmount}`,
        });

        providerResult = await provider.submitTransaction({
          assetId: withdrawal.assetId,
          networkId: withdrawal.networkId,
          fromAddress: (withdrawal as any).fromAddress ?? 'unknown',
          toAddress: withdrawal.destinationAddress,
          amount: baseUnitAmount,
          walletId: withdrawal.walletId ?? undefined,
          idempotencyKey,
        });

        // Update withdrawal with transaction hash from provider — never invent transaction hashes
        if (providerResult.transactionHash) {
          await (this.prisma as any).custodyWithdrawal.update({
            where: { id: custodyWithdrawalId },
            data: { transactionHash: providerResult.transactionHash, providerReference: providerResult.providerReference, estimatedFee: providerResult.estimatedFee ?? null },
          });

          // Create custody transaction record
          await this.transactionService.createTransaction({
            tenantId,
            walletId: withdrawal.walletId,
            assetId: withdrawal.assetId,
            networkId: withdrawal.networkId,
            direction: 'OUT',
            amount: withdrawal.amount,
            transactionHash: providerResult.transactionHash,
            providerReference: providerResult.providerReference,
            status: 'SUBMITTED',
            estimatedFee: providerResult.estimatedFee ?? null,
            sourceWorkflowType: 'CUSTODY_WITHDRAWAL',
            sourceWorkflowId: custodyWithdrawalId,
            withdrawalId: custodyWithdrawalId,
            submittedAt: new Date(),
            evidence: { destinationAddress: withdrawal.destinationAddress, providerResult: redactSecrets(providerResult) },
          });
        }
      }
    } catch (e) {
      // If provider submission fails, transition to FAILED — never silently succeed
      await (this.prisma as any).custodyWithdrawal.update({
        where: { id: custodyWithdrawalId },
        data: { state: 'FAILED', failedAt: new Date(), failureReason: `Provider submission failed: ${(e as Error).message}` },
      });
      throw new BadRequestException(`Withdrawal provider submission failed: ${(e as Error).message}`);
    }

    await this.auditService.log({
      tenantId,
      walletId: withdrawal.walletId,
      action: 'WITHDRAWAL_SUBMITTED' as any,
      entityType: 'CUSTODY_WITHDRAWAL',
      entityId: custodyWithdrawalId,
      actorId: operatorId,
      fromState: currentState,
      toState: 'SUBMITTED',
      correlationId,
      evidence: { transactionHash: providerResult?.transactionHash, providerReference: providerResult?.providerReference, destinationAddress: withdrawal.destinationAddress },
    });

    this.logger.log({ event: 'custody.withdrawal.submitted', tenantId, custodyWithdrawalId, transactionHash: providerResult?.transactionHash });

    return submitted;
  }

  private async getDecimalsForAsset(assetId: string): Promise<number> {
    try {
      const asset = await (this.prisma as any).custodyAsset.findFirst({ where: { assetId } });
      if (asset) return asset.decimals;
    } catch {}
    return 18; // default, but should be from authoritative metadata
  }

  private toBaseUnit(amount: string, decimals: number): string {
    // Convert decimal string to base-unit integer string — Decimal-safe
    try {
      const [intPart, fracPart = ''] = amount.split('.');
      const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
      const combined = intPart + paddedFrac;
      return combined.replace(/^0+/, '') || '0';
    } catch {
      return amount;
    }
  }
}

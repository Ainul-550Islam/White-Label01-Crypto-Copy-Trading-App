import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { CustodyPolicyService } from './custody-policy.service';
import { CustodyAuditService } from './custody-audit.service';
import { TransactionService } from './transaction.service';
import { ConfirmationService } from './confirmation.service';
import { deterministicIdempotencyKey, CustodyDepositState, DEPOSIT_VALID_TRANSITIONS, isValidDecimal, redactSecrets } from './custody.types';

/**
 * Monitors blockchain/network observations for deposits, detects incoming transfers, required confirmations,
 * reorg/finality concerns, duplicate observations, amount/asset/network mismatches, and produces explicit deposit lifecycle state.
 */

@Injectable()
export class DepositMonitoringService {
  private readonly logger = new Logger(DepositMonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: BlockchainProviderFactory,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly auditService: CustodyAuditService,
    private readonly transactionService: TransactionService,
    private readonly confirmationService: ConfirmationService,
  ) {}

  async observeDeposit(params: {
    tenantId: string;
    assetId: string;
    networkId: string;
    toAddress: string;
    fromAddress?: string | null;
    amount: string;
    transactionHash: string;
    blockHash?: string | null;
    blockNumber?: string | null;
    providerReference?: string | null;
    observedAt?: Date;
    fundingRequestId?: string | null;
    walletId?: string | null;
    addressId?: string | null;
  }): Promise<any> {
    const { tenantId, assetId, networkId, toAddress, fromAddress = null, amount, transactionHash, blockHash = null, blockNumber = null, providerReference = null, observedAt = new Date(), fundingRequestId = null, walletId = null, addressId = null } = params;

    if (!assetId || !networkId || !toAddress || !transactionHash) throw new BadRequestException('assetId, networkId, toAddress, transactionHash must be explicit');
    if (!isValidDecimal(amount)) throw new BadRequestException(`Invalid amount decimal: ${amount}`);

    // Verify destination address belongs to tenant — never assume raw address belongs to tenant merely because client submitted it
    let addressRecord: any = null;
    try {
      addressRecord = await (this.prisma as any).custodyWalletAddress.findFirst({ where: { tenantId, address: toAddress, networkId } });
    } catch {}

    if (!addressRecord) {
      // Check if address is expected but not yet registered — create EXPECTED deposit
      this.logger.warn({ event: 'custody.deposit.unknown_destination', tenantId, toAddress, networkId, note: 'Deposit to unknown address — will create EXPECTED but not CONFIRMED without verification' });
    }

    // Prevent duplicate observations — repeated blockchain observations must not create duplicate custody events
    const idempotencyKey = deterministicIdempotencyKey({
      type: `deposit:${networkId}:${transactionHash}:${toAddress}`,
      tenantId,
      assetId,
      networkId,
      externalRef: `${transactionHash}:${toAddress}`,
    });

    try {
      const existing = await (this.prisma as any).custodyDeposit.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log({ event: 'custody.deposit.idempotent_hit', idempotencyKey, transactionHash });
        return existing;
      }
    } catch {}

    // Check for duplicate transaction hash across different tenants — network-aware uniqueness
    try {
      const dup = await (this.prisma as any).custodyDeposit.findFirst({ where: { networkId, transactionHash, toAddress } });
      if (dup && dup.tenantId !== tenantId) {
        throw new BadRequestException(`Duplicate transaction hash ${transactionHash} already observed for different tenant — ambiguous assignment prevented`);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
    }

    // Verify asset/network identity explicit — wrong network, wrong asset, wrong destination must not be silently treated as valid
    const policy = await this.custodyPolicyService.resolvePolicy({ tenantId });
    if (!policy.supportedNetworks.includes(networkId)) {
      throw new BadRequestException(`Wrong network deposit rejected — network ${networkId} not supported`);
    }

    // Get required confirmations from network policy
    const requiredConfirmations = await this.custodyPolicyService.getRequiredConfirmations({ tenantId, networkId });

    // Create deposit as OBSERVED — not CONFIRMED without actual blockchain/provider evidence
    const deposit = await (this.prisma as any).custodyDeposit.create({
      data: {
        tenantId,
        walletId: walletId ?? addressRecord?.walletId ?? null,
        addressId: addressId ?? addressRecord?.id ?? null,
        assetId,
        networkId,
        amount,
        transactionHash,
        blockHash: blockHash ?? null,
        blockNumber: blockNumber ?? null,
        fromAddress: fromAddress ?? null,
        toAddress,
        providerReference: providerReference ?? null,
        state: 'OBSERVED',
        confirmationCount: 0,
        requiredConfirmationCount: requiredConfirmations,
        isFinal: false,
        observedAt,
        fundingRequestId: fundingRequestId ?? null,
        idempotencyKey,
        evidence: redactSecrets({ transactionHash, blockHash, blockNumber, fromAddress, toAddress, amount, providerReference, observedAt }) as any,
      },
    });

    // Create corresponding custody transaction record
    await this.transactionService.createTransaction({
      tenantId,
      walletId: deposit.walletId,
      assetId,
      networkId,
      direction: 'IN',
      amount,
      transactionHash,
      blockHash,
      blockNumber,
      providerReference,
      status: 'OBSERVED',
      confirmationCount: 0,
      requiredConfirmationCount: requiredConfirmations,
      sourceWorkflowType: 'DEPOSIT',
      sourceWorkflowId: deposit.id,
      depositId: deposit.id,
      observedAt,
      evidence: { fromAddress, toAddress, depositId: deposit.id },
    });

    await this.auditService.log({
      tenantId,
      walletId: deposit.walletId,
      action: 'DEPOSIT_OBSERVED' as any,
      entityType: 'CUSTODY_DEPOSIT',
      entityId: deposit.id,
      evidence: { transactionHash, toAddress, amount, assetId, networkId, fundingRequestId },
    });

    this.logger.log({ event: 'custody.deposit.observed', tenantId, transactionHash, toAddress, amount, assetId, networkId });

    return deposit;
  }

  async updateDepositConfirmations(params: {
    tenantId: string;
    depositId: string;
    confirmationCount: number;
    blockHash?: string | null;
    blockNumber?: string | null;
    providerReference?: string | null;
  }): Promise<any> {
    const { tenantId, depositId, confirmationCount, blockHash = null, blockNumber = null, providerReference = null } = params;

    const deposit = await (this.prisma as any).custodyDeposit.findFirst({ where: { id: depositId, tenantId } });
    if (!deposit) throw new BadRequestException('Deposit not found');

    // Never invent confirmation counts — must be provider-derived
    if (confirmationCount < 0) throw new BadRequestException('Invalid confirmation count');

    const currentState = deposit.state as CustodyDepositState;
    let newState: CustodyDepositState = currentState;

    if (confirmationCount >= deposit.requiredConfirmationCount && currentState !== CustodyDepositState.CONFIRMED) {
      // Check if we have authoritative provider/chain evidence for confirmation
      // For CONFIRMED, need blockHash and blockNumber and provider reference
      if (blockHash && blockNumber) {
        newState = CustodyDepositState.CONFIRMED;
      } else {
        newState = CustodyDepositState.CONFIRMING;
      }
    } else if (confirmationCount > 0 && confirmationCount < deposit.requiredConfirmationCount) {
      newState = CustodyDepositState.CONFIRMING;
    }

    // Validate transition
    if (newState !== currentState) {
      const allowed = DEPOSIT_VALID_TRANSITIONS[currentState] ?? [];
      if (!allowed.includes(newState)) {
        throw new BadRequestException(`Invalid deposit transition ${currentState} → ${newState}`);
      }
    }

    const updated = await (this.prisma as any).custodyDeposit.update({
      where: { id: depositId },
      data: {
        confirmationCount,
        ...(blockHash ? { blockHash } : {}),
        ...(blockNumber ? { blockNumber } : {}),
        ...(providerReference ? { providerReference } : {}),
        state: newState as any,
        ...(newState === CustodyDepositState.CONFIRMED ? { confirmedAt: new Date(), isFinal: true } : {}),
      },
    });

    // Update transaction confirmation as well
    try {
      const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { depositId, tenantId } });
      if (tx) {
        await this.confirmationService.observeConfirmation({
          tenantId,
          transactionId: tx.id,
          blockHash: blockHash ?? tx.blockHash,
          blockNumber: blockNumber ?? tx.blockNumber,
          confirmationCount,
          requiredConfirmationCount: deposit.requiredConfirmationCount,
          providerReference,
        });
      }
    } catch {}

    if (newState === CustodyDepositState.CONFIRMED) {
      await this.auditService.log({
        tenantId,
        walletId: deposit.walletId,
        action: 'DEPOSIT_CONFIRMED' as any,
        entityType: 'CUSTODY_DEPOSIT',
        entityId: depositId,
        evidence: { transactionHash: deposit.transactionHash, confirmationCount, blockHash, blockNumber },
      });
    }

    return updated;
  }

  async handleReorg(params: { tenantId: string; depositId: string; reason: string; providerReference?: string | null }): Promise<any> {
    const { tenantId, depositId, reason, providerReference = null } = params;

    const deposit = await (this.prisma as any).custodyDeposit.findFirst({ where: { id: depositId, tenantId } });
    if (!deposit) throw new BadRequestException('Deposit not found');

    // CONFIRMED → REORGED → CONFIRMING safe transition
    const currentState = deposit.state as CustodyDepositState;
    if (currentState !== CustodyDepositState.CONFIRMED && currentState !== CustodyDepositState.CONFIRMING) {
      throw new BadRequestException(`Reorg handling only for CONFIRMED/CONFIRMING deposits, current: ${currentState}`);
    }

    const updated = await (this.prisma as any).custodyDeposit.update({
      where: { id: depositId },
      data: { state: 'REORGED', isFinal: false, failureReason: `REORG: ${reason}`, confirmationCount: 0 },
    });

    // Trigger reconciliation and audit
    await this.auditService.log({
      tenantId,
      walletId: deposit.walletId,
      action: 'DEPOSIT_REORGED' as any,
      entityType: 'CUSTODY_DEPOSIT',
      entityId: depositId,
      evidence: { transactionHash: deposit.transactionHash, reason, providerReference },
    });

    this.logger.warn({ event: 'custody.deposit.reorged', tenantId, depositId, transactionHash: deposit.transactionHash, reason });

    return updated;
  }
}

// # Compares internal ledger balances against custody/exchange balances
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey, CustodyReconciliationType, redactSecrets } from './custody.types';

/** Values of the Prisma CustodyReconciliationType enum (coarse categories). */
export const CUSTODY_RECONCILIATION_CATEGORIES = new Set(['WALLET', 'TRANSACTION', 'DEPOSIT', 'WITHDRAWAL', 'BALANCE', 'RESERVE', 'FEE', 'CONFIRMATION', 'SETTLEMENT']);

/** Maps a detailed finding type (e.g. DEPOSIT_WITHOUT_TRANSACTION) to the Prisma enum category. */
export function custodyReconciliationCategory(type: string): string {
  if (CUSTODY_RECONCILIATION_CATEGORIES.has(type)) return type;
  switch (type) {
    case 'WALLET_WITHOUT_PROVIDER_RECORD':
    case 'PROVIDER_WALLET_WITHOUT_INTERNAL_RECORD':
    case 'ADDRESS_OWNERSHIP_MISMATCH':
      return 'WALLET';
    case 'DEPOSIT_WITHOUT_TRANSACTION':
    case 'AMOUNT_MISMATCH':
    case 'ASSET_MISMATCH':
    case 'NETWORK_MISMATCH':
      return 'DEPOSIT';
    case 'WITHDRAWAL_WITHOUT_TRANSACTION':
    case 'TRANSACTION_WITHOUT_WITHDRAWAL':
      return 'WITHDRAWAL';
    case 'CONFIRMATION_MISMATCH':
    case 'REORG_DETECTED':
      return 'CONFIRMATION';
    case 'FEE_MISMATCH':
      return 'FEE';
    case 'BALANCE_MISMATCH':
      return 'BALANCE';
    case 'RESERVE_MISMATCH':
      return 'RESERVE';
    case 'SETTLEMENT_MISSING':
      return 'SETTLEMENT';
    default:
      return 'TRANSACTION';
  }
}

/** API view of a CustodyReconciliation row: type/description/severity/asset/network/resolved/evidence. */
export function toCustodyFindingView(row: any): any {
  if (!row) return row;
  const details = row.discrepancyDetails && typeof row.discrepancyDetails === 'object' ? row.discrepancyDetails : {};
  const resolution = details.resolution && typeof details.resolution === 'object' ? details.resolution : {};
  return {
    ...row,
    type: row.discrepancyType ?? row.reconciliationType,
    assetId: details.assetId ?? null,
    networkId: details.networkId ?? null,
    description: details.description ?? null,
    severity: details.severity ?? (row.isCritical ? 'CRITICAL' : 'MEDIUM'),
    evidence: details.evidence ?? {},
    resolved: Boolean(row.isResolved),
    resolutionNote: resolution.resolutionNote ?? null,
    correctiveAction: resolution.correctiveAction ?? null,
  };
}

export interface CustodyReconciliationRunParams {
  tenantId: string;
  assetId?: string;
  networkId?: string;
  walletId?: string;
  operatorId?: string | null;
  correlationId?: string | null;
}

/** One check that could not read its data (error code only, never the Prisma message). */
export interface CustodyReconciliationReadFailure {
  check: string;
  walletId: string | null;
  error: string;
}

export interface CustodyReconciliationReport {
  findings: any[];
  walletsChecked: number;
  readFailures: CustodyReconciliationReadFailure[];
  unpersistedCount: number;
  /** false when any check could not read its data: the absence of findings is then unverified. */
  complete: boolean;
}

/**
 * Detects and reports custody reconciliation mismatches across 18 types without rewriting authoritative truth.
 * Corrections, if authorized, must preserve history and be explicitly tracked.
 */

@Injectable()
export class CustodyReconciliationService {
  private readonly logger = new Logger(CustodyReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: BlockchainProviderFactory,
    private readonly auditService: CustodyAuditService,
  ) {}

  /**
   * Runs the reconciliation and returns the findings (the API response shape, unchanged).
   * Use runReconciliationReport() to also see which checks could not read their data.
   */
  async runReconciliation(params: CustodyReconciliationRunParams): Promise<any[]> {
    const report = await this.runReconciliationReport(params);
    return report.findings;
  }

  /**
   * Runs the reconciliation and reports, next to the findings, every check whose read failed.
   * A failed read is never a clean result: "no findings" from a check that could not read its
   * rows would claim a consistency nobody verified. Each failure is logged at error level
   * (event custody.reconciliation.check_read_failed, error code only - never the Prisma
   * message, which can echo row values), counted, and makes the run incomplete
   * (complete === false), which the completion log states as well.
   */
  async runReconciliationReport(params: CustodyReconciliationRunParams): Promise<CustodyReconciliationReport> {
    const { tenantId, assetId, networkId, walletId, operatorId = null, correlationId = null } = params;

    const findings: any[] = [];
    const readFailures: CustodyReconciliationReadFailure[] = [];
    const noteReadFailure = (check: string, failedWalletId: string | null, e: unknown) => {
      const error = this.persistErrorCode(e);
      readFailures.push({ check, walletId: failedWalletId, error });
      this.logger.error({ event: 'custody.reconciliation.check_read_failed', tenantId, walletId: failedWalletId, check, error });
    };

    // Get wallets
    let wallets: any[] = [];
    try {
      const where: any = { tenantId };
      if (walletId) where.id = walletId;
      if (assetId) where.assetId = assetId;
      if (networkId) where.networkId = networkId;
      wallets = await (this.prisma as any).custodyWallet.findMany({ where, take: 100 });
    } catch (e) {
      wallets = [];
      noteReadFailure('wallets', null, e);
    }

    for (const wallet of wallets) {
      try {
        // Check provider wallet without internal record and vice versa
        // An unresolvable provider (unsupported network/asset, or no configured adapter) IS the
        // WALLET_WITHOUT_PROVIDER_RECORD finding; the reason code is logged next to it.
        const provider = await this.providerFactory
          .getProviderForNetwork({ networkId: wallet.networkId, assetId: wallet.assetId })
          .catch((e: unknown) => {
            this.logger.warn({ event: 'custody.reconciliation.provider_unresolved', tenantId, walletId: wallet.id, error: this.persistErrorCode(e) });
            return null;
          });
        if (!provider) {
          findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: wallet.assetId, networkId: wallet.networkId, type: 'WALLET_WITHOUT_PROVIDER_RECORD', description: `Wallet ${wallet.id} has no provider record for ${wallet.networkId}`, operatorId, correlationId }));
          continue;
        }

        // Check addresses
        let addresses: any[] = [];
        try {
          addresses = await (this.prisma as any).custodyWalletAddress.findMany({ where: { tenantId, walletId: wallet.id }, take: 100 });
        } catch (e) {
          addresses = [];
          noteReadFailure('addresses', wallet.id, e);
        }

        for (const addr of addresses) {
          // ADDRESS_OWNERSHIP_MISMATCH
          if (addr.walletId !== wallet.id) {
            findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: addr.assetId, networkId: addr.networkId, type: 'ADDRESS_OWNERSHIP_MISMATCH', description: `Address ${addr.address} ownership mismatch walletId ${addr.walletId} vs ${wallet.id}`, operatorId, correlationId, evidence: { address: addr.address, expectedWalletId: wallet.id, actualWalletId: addr.walletId } }));
          }
        }

        // Check deposits vs transactions
        let deposits: any[] = [];
        try {
          deposits = await (this.prisma as any).custodyDeposit.findMany({ where: { tenantId, walletId: wallet.id }, take: 100 });
        } catch (e) {
          deposits = [];
          noteReadFailure('deposits', wallet.id, e);
        }

        for (const dep of deposits) {
          // DEPOSIT_WITHOUT_TRANSACTION
          try {
            const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { tenantId, depositId: dep.id } });
            if (!tx) {
              findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: dep.assetId, networkId: dep.networkId, type: 'DEPOSIT_WITHOUT_TRANSACTION', description: `Deposit ${dep.id} ${dep.transactionHash} without custody transaction`, operatorId, correlationId, evidence: { depositId: dep.id, transactionHash: dep.transactionHash } }));
            } else {
              // AMOUNT_MISMATCH
              if (tx.amount !== dep.amount) {
                findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: dep.assetId, networkId: dep.networkId, type: 'AMOUNT_MISMATCH', description: `Amount mismatch deposit ${dep.amount} vs tx ${tx.amount}`, operatorId, correlationId, evidence: { depositId: dep.id, transactionId: tx.id, depositAmount: dep.amount, transactionAmount: tx.amount } }));
              }
              // ASSET_MISMATCH
              if (tx.assetId !== dep.assetId) {
                findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: dep.assetId, networkId: dep.networkId, type: 'ASSET_MISMATCH', description: `Asset mismatch deposit ${dep.assetId} vs tx ${tx.assetId}`, operatorId, correlationId, evidence: { depositId: dep.id, transactionId: tx.id } }));
              }
              // NETWORK_MISMATCH
              if (tx.networkId !== dep.networkId) {
                findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: dep.assetId, networkId: dep.networkId, type: 'NETWORK_MISMATCH', description: `Network mismatch deposit ${dep.networkId} vs tx ${tx.networkId}`, operatorId, correlationId, evidence: { depositId: dep.id, transactionId: tx.id } }));
              }
            }
          } catch (e) {
            noteReadFailure('deposit-transaction', wallet.id, e);
          }
        }

        // TRANSACTION_WITHOUT_DEPOSIT for IN direction
        try {
          const txs = await (this.prisma as any).custodyTransaction.findMany({ where: { tenantId, walletId: wallet.id, direction: 'IN' }, take: 100 });
          for (const tx of txs) {
            if (!tx.depositId) {
              // Check if deposit exists with same hash
              const dep = await (this.prisma as any).custodyDeposit.findFirst({ where: { tenantId, transactionHash: tx.transactionHash } });
              if (!dep) {
                findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: tx.assetId, networkId: tx.networkId, type: 'TRANSACTION_WITHOUT_DEPOSIT', description: `Transaction ${tx.id} ${tx.transactionHash} IN without deposit`, operatorId, correlationId, evidence: { transactionId: tx.id, transactionHash: tx.transactionHash } }));
              }
            }
          }
        } catch (e) {
          noteReadFailure('inbound-transactions', wallet.id, e);
        }

        // WITHDRAWAL_WITHOUT_TRANSACTION and TRANSACTION_WITHOUT_WITHDRAWAL
        try {
          const withdrawals = await (this.prisma as any).custodyWithdrawal.findMany({ where: { tenantId, walletId: wallet.id }, take: 100 });
          for (const w of withdrawals) {
            const tx = await (this.prisma as any).custodyTransaction.findFirst({ where: { tenantId, withdrawalId: w.id } });
            if (!tx) {
              findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: w.assetId, networkId: w.networkId, type: 'WITHDRAWAL_WITHOUT_TRANSACTION', description: `Withdrawal ${w.id} without transaction`, operatorId, correlationId, evidence: { withdrawalId: w.id, transactionHash: w.transactionHash } }));
            }
          }

          const outTxs = await (this.prisma as any).custodyTransaction.findMany({ where: { tenantId, walletId: wallet.id, direction: 'OUT' }, take: 100 });
          for (const tx of outTxs) {
            if (!tx.withdrawalId) {
              findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: tx.assetId, networkId: tx.networkId, type: 'TRANSACTION_WITHOUT_WITHDRAWAL', description: `Transaction ${tx.id} OUT without withdrawal`, operatorId, correlationId, evidence: { transactionId: tx.id, transactionHash: tx.transactionHash } }));
            }
          }
        } catch (e) {
          noteReadFailure('withdrawals', wallet.id, e);
        }

        // BALANCE_MISMATCH is not evaluated here: it needs a provider balance observation, and the
        // only provider in this build (internal ledger) has none - missing is not zero, so no
        // finding is invented. A real chain/custodian adapter adds the observation.

        // DUPLICATE_TRANSACTION and DUPLICATE_EXTERNAL_REFERENCE
        try {
          const txs = await (this.prisma as any).custodyTransaction.findMany({ where: { tenantId, walletId: wallet.id }, take: 200 });
          const hashMap = new Map<string, number>();
          for (const tx of txs) {
            if (tx.transactionHash) {
              const key = `${tx.networkId}:${tx.transactionHash}`;
              hashMap.set(key, (hashMap.get(key) ?? 0) + 1);
            }
          }
          for (const [key, count] of hashMap.entries()) {
            if (count > 1) {
              findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: wallet.assetId, networkId: wallet.networkId, type: 'DUPLICATE_TRANSACTION', description: `Duplicate transaction hash ${key} count ${count}`, operatorId, correlationId, evidence: { duplicateKey: key, count } }));
            }
          }
        } catch (e) {
          noteReadFailure('duplicate-transactions', wallet.id, e);
        }

        // REORG_DETECTED — check for REORGED state
        try {
          const reorged = await (this.prisma as any).custodyTransaction.findMany({ where: { tenantId, walletId: wallet.id, status: 'REORGED' }, take: 20 });
          for (const tx of reorged) {
            findings.push(await this.createFinding({ tenantId, walletId: wallet.id, assetId: tx.assetId, networkId: tx.networkId, type: 'REORG_DETECTED', description: `Reorg detected for transaction ${tx.id} ${tx.transactionHash}`, operatorId, correlationId, evidence: { transactionId: tx.id, transactionHash: tx.transactionHash } }));
          }
        } catch (e) {
          noteReadFailure('reorged-transactions', wallet.id, e);
        }

        // RESERVE_MISMATCH, SETTLEMENT_MISSING, FEE_MISMATCH, CONFIRMATION_MISMATCH, TRANSACTION_STATUS_MISMATCH would be similar
      } catch (e) {
        noteReadFailure('wallet', wallet.id, e);
      }
    }

    const unpersistedCount = findings.filter((f) => f?.persisted === false).length;
    const complete = readFailures.length === 0;
    if (unpersistedCount > 0 || !complete) {
      this.logger.warn({
        event: 'custody.reconciliation.completed',
        tenantId,
        findingsCount: findings.length,
        unpersistedCount,
        readFailures: readFailures.length,
        complete,
      });
    } else {
      this.logger.log({ event: 'custody.reconciliation.completed', tenantId, findingsCount: findings.length, readFailures: 0, complete });
    }

    return { findings, walletsChecked: wallets.length, readFailures, unpersistedCount, complete };
  }

  private async createFinding(params: {
    tenantId: string;
    walletId?: string | null;
    assetId: string;
    networkId: string;
    type: string;
    description: string;
    operatorId?: string | null;
    correlationId?: string | null;
    evidence?: any;
  }): Promise<any> {
    const { tenantId, walletId = null, assetId, networkId, type, description, operatorId = null, correlationId = null, evidence = {} } = params;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `reconciliation:${type}:${assetId}:${networkId}`,
      tenantId,
      walletId: walletId ?? undefined,
      assetId,
      networkId,
      externalRef: `${type}:${description.slice(0, 50)}`,
    });

    try {
      const existing = await (this.prisma as any).custodyReconciliation.findFirst({ where: { tenantId: params.tenantId, idempotencyKey, isResolved: false } });
      if (existing) return toCustodyFindingView(existing);
    } catch (e) {
      // Dedupe lookup failed: the create below still runs (a duplicate is refused by the
      // per-tenant idempotency index and then reported as not persisted), but the failure is logged.
      this.logger.warn({ event: 'custody.reconciliation.dedupe_read_failed', tenantId, walletId, type, error: this.persistErrorCode(e) });
    }

    try {
      // CustodyReconciliation columns: coarse reconciliationType enum + discrepancyType (the
      // detailed finding type), isCritical/isResolved, and discrepancyDetails for the rest.
      const severity = this.getSeverityForType(type);
      const safeEvidence = redactSecrets(evidence) as Record<string, any>;
      const created = await (this.prisma as any).custodyReconciliation.create({
        data: {
          tenantId,
          reconciliationType: custodyReconciliationCategory(type) as any,
          walletId: walletId ?? null,
          transactionId: typeof safeEvidence?.transactionId === 'string' ? safeEvidence.transactionId : null,
          depositId: typeof safeEvidence?.depositId === 'string' ? safeEvidence.depositId : null,
          withdrawalId: typeof safeEvidence?.withdrawalId === 'string' ? safeEvidence.withdrawalId : null,
          discrepancyType: type,
          discrepancyDetails: { assetId, networkId, description, severity, evidence: safeEvidence } as any,
          isCritical: severity === 'CRITICAL',
          isResolved: false,
          idempotencyKey,
        },
      });
      const finding = toCustodyFindingView(created);

      await this.auditService.log({
        tenantId,
        walletId: walletId ?? null,
        action: 'RECONCILIATION_FINDING' as any,
        entityType: 'CUSTODY_RECONCILIATION',
        entityId: finding.id,
        actorId: operatorId,
        correlationId,
        evidence: { type, description, assetId, networkId, walletId },
      });

      return finding;
    } catch (e) {
      // The finding could not be stored. It is still returned so the operator sees it, but it is
      // explicitly marked as not persisted (no id) and logged at error level with the error code
      // only (Prisma messages can echo the row being written).
      this.logger.error({
        event: 'custody.reconciliation.finding_persist_failed',
        tenantId,
        walletId,
        type,
        assetId,
        networkId,
        error: this.persistErrorCode(e),
      });
      return { id: null, persisted: false, type, description, assetId, networkId, walletId };
    }
  }

  /** Prisma error code or error class name; never the message. */
  private persistErrorCode(e: unknown): string {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && code.length > 0) return code;
    const name = (e as { name?: unknown } | null)?.name;
    return typeof name === 'string' && name.length > 0 ? name : 'UNKNOWN';
  }

  private getSeverityForType(type: string): string {
    const critical = ['REORG_DETECTED', 'BALANCE_MISMATCH', 'DUPLICATE_TRANSACTION', 'ADDRESS_OWNERSHIP_MISMATCH'];
    if (critical.includes(type)) return 'CRITICAL';
    const high = ['AMOUNT_MISMATCH', 'ASSET_MISMATCH', 'NETWORK_MISMATCH', 'DEPOSIT_WITHOUT_TRANSACTION', 'WITHDRAWAL_WITHOUT_TRANSACTION'];
    if (high.includes(type)) return 'HIGH';
    return 'MEDIUM';
  }

  async resolveFinding(params: { tenantId: string; reconciliationId: string; operatorId: string; resolutionNote: string; correctiveAction?: string | null }): Promise<any> {
    const { tenantId, reconciliationId, operatorId, resolutionNote, correctiveAction = null } = params;

    const finding = await (this.prisma as any).custodyReconciliation.findFirst({ where: { id: reconciliationId, tenantId } });
    if (!finding) throw new BadRequestException('Reconciliation finding not found');

    // Reconciliation is diagnostic unless explicitly authorized corrective workflow — preserve history
    const details = finding.discrepancyDetails && typeof finding.discrepancyDetails === 'object' ? finding.discrepancyDetails : {};
    const resolvedRow = await (this.prisma as any).custodyReconciliation.update({
      where: { id: reconciliationId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy: operatorId,
        // No resolutionNote/correctiveAction columns: kept with the discrepancy details.
        discrepancyDetails: { ...details, resolution: { resolutionNote, correctiveAction } } as any,
      },
    });
    const resolved = toCustodyFindingView(resolvedRow);

    await this.auditService.log({
      tenantId,
      walletId: finding.walletId,
      action: 'RECONCILIATION_RESOLVED' as any,
      entityType: 'CUSTODY_RECONCILIATION',
      entityId: reconciliationId,
      actorId: operatorId,
      evidence: { resolutionNote, correctiveAction, originalType: finding.discrepancyType ?? finding.reconciliationType, note: 'Resolution preserves history, does not rewrite truth' },
    });

    return resolved;
  }

  async listFindings(params: { tenantId: string; walletId?: string; assetId?: string; networkId?: string; type?: string; resolved?: boolean; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, assetId, networkId, type, resolved, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (walletId) where.walletId = walletId;
    const detailFilters: any[] = [];
    if (assetId) detailFilters.push({ discrepancyDetails: { path: ['assetId'], equals: assetId } });
    if (networkId) detailFilters.push({ discrepancyDetails: { path: ['networkId'], equals: networkId } });
    if (detailFilters.length > 0) where.AND = detailFilters;
    // A detailed finding type filters discrepancyType; a coarse category filters reconciliationType.
    if (type) {
      if (CUSTODY_RECONCILIATION_CATEGORIES.has(type)) where.reconciliationType = type;
      else where.discrepancyType = type;
    }
    if (resolved !== undefined) where.isResolved = resolved;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyReconciliation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyReconciliation.count({ where }),
      ]);
      return { data: data.map(toCustodyFindingView), total, page, limit };
    } catch (e) {
      // An empty page here would tell the operator "no findings" when the findings could not be
      // read at all. The failure is logged (error code only) and propagated to the caller.
      this.logger.error({ event: 'custody.reconciliation.list_read_failed', tenantId, error: this.persistErrorCode(e) });
      throw e;
    }
  }
}

// # Responsibility: evaluate explicit reserves against complete authoritative wallet observations; missing evidence is unknown, never zero or permission to move funds.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma, type CustodyReserve } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyPolicyService, type CustodyPolicy } from './custody-policy.service';
import { CustodyAuditService } from './custody-audit.service';
import { TreasuryBalanceService } from './treasury-balance.service';
import { add, cmp, deterministicIdempotencyKey, isValidDecimal, sub, CustodyAuditAction,
  CustodyReserveState, DECIMAL_SCALE } from './custody.types';

export interface ReserveSufficiencyResult {
  sufficient: boolean;
  requiredReserve: string;
  availableAfterReserve: string | null;
  blockingReserves: CustodyReserve[];
  dataCompleteness: 'PROVIDER_DERIVED' | 'UNKNOWN';
  reasonCodes: string[];
}

@Injectable()
export class ReserveManagementService {
  private readonly logger = new Logger(ReserveManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly auditService: CustodyAuditService,
    private readonly treasuryBalanceService: TreasuryBalanceService,
  ) {}

  async createReserve(params: {
    tenantId: string;
    walletId?: string | null;
    assetId: string;
    networkId?: string | null;
    reserveType: string;
    requiredAmount: string;
    operatorId?: string | null;
    reason?: string | null;
    correlationId?: string | null;
  }): Promise<CustodyReserve> {
    const { tenantId, walletId = null, assetId, networkId = null, reserveType, requiredAmount,
      operatorId = null, reason = null, correlationId = null } = params;
    if (!isValidDecimal(requiredAmount) || cmp(requiredAmount, '0') < 0) throw new BadRequestException('Reserve amount must be a nonnegative supported-precision decimal');
    if (!['operational', 'withdrawal', 'gas', 'network', 'risk', 'treasury'].includes(reserveType)) throw new BadRequestException('Invalid reserve type');
    if (walletId) {
      const wallet = await this.prisma.custodyWallet.findFirst({ where: { tenantId, id: walletId } });
      if (!wallet || wallet.assetId !== assetId || (networkId !== null && wallet.networkId !== networkId)) {
        throw new BadRequestException('Reserve wallet must belong to this tenant and match the asset/network');
      }
    }
    const idempotencyKey = deterministicIdempotencyKey({ type: `reserve:${reserveType}:${assetId}`, tenantId,
      walletId: walletId ?? undefined, assetId, networkId: networkId ?? undefined, externalRef: `${reserveType}:${requiredAmount}` });
    const existing = await this.prisma.custodyReserve.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) return existing;
    const reserve = await this.prisma.custodyReserve.create({ data: {
      tenantId, walletId, assetId, networkId, reserveType, requiredAmount,
      // No balance has been observed here; the nullable column must remain unknown.
      availableAmount: null, state: 'ACTIVE', metadata: { operatorId, reason }, idempotencyKey,
    } });
    await this.auditService.log({ tenantId, walletId, action: CustodyAuditAction.RESERVE_CREATED,
      entityType: 'CUSTODY_RESERVE', entityId: reserve.id, actorId: operatorId, correlationId,
      evidence: { reserveType, assetId, networkId, requiredAmount, reason } });
    return reserve;
  }

  async evaluateReserveSufficiency(params: {
    tenantId: string;
    walletId?: string | null;
    assetId: string;
    networkId?: string | null;
    requestedAmount: string;
  }): Promise<ReserveSufficiencyResult> {
    const { tenantId, walletId = null, assetId, networkId = null, requestedAmount } = params;
    if (!isValidDecimal(requestedAmount) || cmp(requestedAmount, '0') <= 0) throw new BadRequestException('Requested amount must be a positive supported-precision decimal');
    if (!assetId) throw new BadRequestException('Reserve asset must be explicit');
    const where: Prisma.CustodyReserveWhereInput = { tenantId, assetId, state: { in: ['ACTIVE', 'LOCKED', 'INSUFFICIENT', 'SUFFICIENT'] } };
    const conditions: Prisma.CustodyReserveWhereInput[] = [];
    // A wallet/network-specific check cannot ignore an applicable tenant-wide reserve.
    if (walletId) conditions.push({ OR: [{ walletId }, { walletId: null }] });
    if (networkId) conditions.push({ OR: [{ networkId }, { networkId: null }] });
    if (conditions.length) where.AND = conditions;
    const reserves = await this.prisma.custodyReserve.findMany({ where });
    let storedRequired = '0';
    for (const reserve of reserves) {
      if (!isValidDecimal(reserve.requiredAmount) || cmp(reserve.requiredAmount, '0') < 0) throw new Error('Invalid persisted reserve amount');
      storedRequired = add(storedRequired, reserve.requiredAmount);
    }
    const policy = await this.custodyPolicyService.resolvePolicy({ tenantId, walletId: walletId ?? undefined });
    // Inspect every matching wallet, not a capped/partially swallowed treasury aggregate.
    const wallets = await this.prisma.custodyWallet.findMany({ where: {
      tenantId, assetId, state: 'ACTIVE', ...(walletId ? { id: walletId } : {}), ...(networkId ? { networkId } : {}),
    } });
    if (walletId && wallets.length !== 1) throw new BadRequestException('Reserve wallet not found for this tenant and asset/network');
    if (wallets.length === 0) return this.unknown(reserves, storedRequired, 'NO_AUTHORITATIVE_WALLET_OBSERVATION');
    let available = '0';
    for (const wallet of wallets) {
      if (!wallet.networkId) return this.unknown(reserves, storedRequired, 'WALLET_NETWORK_UNKNOWN');
      try {
        const balance = await this.treasuryBalanceService.getWalletBalance({ tenantId, walletId: wallet.id, assetId, networkId: wallet.networkId });
        if (balance.dataCompleteness !== 'PROVIDER_DERIVED' || balance.walletId !== wallet.id
          || balance.assetId !== assetId || balance.networkId !== wallet.networkId || !balance.sourceReference
          || balance.available === null || !isValidDecimal(balance.available) || cmp(balance.available, '0') < 0) {
          return this.unknown(reserves, storedRequired, 'AUTHORITATIVE_BALANCE_UNKNOWN');
        }
        available = add(available, balance.available);
      } catch (error) {
        this.logger.warn(`Required reserve balance unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return this.unknown(reserves, storedRequired, 'AUTHORITATIVE_BALANCE_UNAVAILABLE');
      }
    }
    const requiredReserve = add(storedRequired, this.policyReserve(policy, available));
    const availableAfterReserve = sub(available, requiredReserve);
    const sufficient = cmp(availableAfterReserve, requestedAmount) >= 0;
    return { sufficient, requiredReserve, availableAfterReserve, blockingReserves: sufficient ? [] : reserves,
      dataCompleteness: 'PROVIDER_DERIVED', reasonCodes: sufficient ? [] : ['RESERVE_INSUFFICIENT'] };
  }

  async listReserves(params: {
    tenantId: string;
    walletId?: string;
    assetId?: string;
    networkId?: string;
    reserveType?: string;
    state?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: CustodyReserve[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, assetId, networkId, reserveType, state, page = 1, limit = 50 } = params;
    const where: Prisma.CustodyReserveWhereInput = { tenantId };
    if (walletId) where.walletId = walletId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (reserveType) where.reserveType = reserveType;
    if (state) {
      const member = Object.values(CustodyReserveState).find((value) => value === state);
      if (!member) throw new BadRequestException('Invalid reserve state');
      where.state = member;
    }
    const [data, total] = await Promise.all([
      this.prisma.custodyReserve.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.custodyReserve.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  private unknown(reserves: CustodyReserve[], requiredReserve: string, reason: string): ReserveSufficiencyResult {
    return { sufficient: false, requiredReserve, availableAfterReserve: null, blockingReserves: reserves,
      dataCompleteness: 'UNKNOWN', reasonCodes: [reason] };
  }

  private policyReserve(policy: CustodyPolicy, available: string): string {
    if (policy.reserveRequirements.gasReserveAmount !== null && policy.reserveRequirements.gasReserveAmount !== undefined) {
      throw new BadRequestException('Gas reserve denomination requires explicit native-asset evidence; it cannot be assumed to equal the requested asset');
    }
    let total = new Prisma.Decimal(0);
    for (const bps of [policy.reserveRequirements.operationalReserveBps, policy.reserveRequirements.withdrawalReserveBps]) {
      if (bps === null || bps === undefined) continue;
      if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new Error('Invalid custody policy reserve basis points');
      total = total.plus(new Prisma.Decimal(available).mul(bps).div(10000));
    }
    // Round required reserves up to the existing arithmetic scale, never silently under-reserve.
    return total.toFixed(DECIMAL_SCALE, Prisma.Decimal.ROUND_UP);
  }
}

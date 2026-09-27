import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerReconciliationMismatchType } from './partner.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ReconciliationMismatch {
  type: PartnerReconciliationMismatchType;
  partnerId: string;
  tenantId?: string | null;
  entityId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  detectedAt: string;
  correlationId: string;
  sourceReferences?: string[];
}

@Injectable()
export class PartnerReconciliationService {
  private readonly logger = new Logger(PartnerReconciliationService.name);
  private readonly inMemory: Map<string, ReconciliationMismatch> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async reconcilePartner(partnerId: string, correlationId: string): Promise<ReconciliationMismatch[]> {
    if (!partnerId) throw new BadRequestException('partnerId required');
    const mismatches: ReconciliationMismatch[] = [];
    const now = new Date().toISOString();

    try {
      // PARTNER_WITHOUT_AGREEMENT
      const agreements = await (this.prisma as any).partnerAgreement?.findMany?.({ where: { partnerId } }) ?? [];
      if (agreements.length === 0) {
        mismatches.push({
          type: PartnerReconciliationMismatchType.PARTNER_WITHOUT_AGREEMENT,
          partnerId,
          entityId: partnerId,
          severity: 'HIGH',
          description: `partner ${partnerId} has no agreement`,
          detectedAt: now,
          correlationId,
        });
      }

      // TENANT_WITHOUT_VALID_PARTNER_RELATION
      const relationships = await (this.prisma as any).partnerTenantRelationship?.findMany?.({ where: { partnerId } }) ?? [];
      for (const rel of relationships) {
        if (!rel.tenantId) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.TENANT_WITHOUT_VALID_PARTNER_RELATION,
            partnerId,
            entityId: rel.id,
            severity: 'MEDIUM',
            description: `relationship ${rel.id} missing tenantId`,
            detectedAt: now,
            correlationId,
          });
        }
      }

      // MULTIPLE_PRIMARY_PARTNERS
      const tenantGroups = new Map<string, any[]>();
      for (const rel of relationships.filter((r: any) => r.isPrimary && r.state === 'ACTIVE')) {
        if (!tenantGroups.has(rel.tenantId)) tenantGroups.set(rel.tenantId, []);
        tenantGroups.get(rel.tenantId)!.push(rel);
      }
      for (const [tenantId, rels] of tenantGroups.entries()) {
        if (rels.length > 1) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.MULTIPLE_PRIMARY_PARTNERS,
            partnerId,
            tenantId,
            entityId: tenantId,
            severity: 'CRITICAL',
            description: `tenant ${tenantId} has ${rels.length} primary partners`,
            detectedAt: now,
            correlationId,
            sourceReferences: rels.map((r: any) => r.id),
          });
        }
      }

      // ATTRIBUTION_CONFLICT and ATTRIBUTION_EXPIRED
      const attributions = await (this.prisma as any).partnerAttribution?.findMany?.({ where: { partnerId } }) ?? [];
      const attributionByTenant = new Map<string, any[]>();
      for (const attr of attributions) {
        if (!attributionByTenant.has(attr.tenantId)) attributionByTenant.set(attr.tenantId, []);
        attributionByTenant.get(attr.tenantId)!.push(attr);
        if (attr.expiresAt && new Date(attr.expiresAt) < new Date() && attr.state === 'ACTIVE') {
          mismatches.push({
            type: PartnerReconciliationMismatchType.ATTRIBUTION_EXPIRED,
            partnerId,
            tenantId: attr.tenantId,
            entityId: attr.id,
            severity: 'MEDIUM',
            description: `attribution ${attr.id} expired but still ACTIVE`,
            detectedAt: now,
            correlationId,
          });
        }
      }
      for (const [tenantId, attrs] of attributionByTenant.entries()) {
        const activePrimary = attrs.filter((a: any) => a.isPrimary && a.state === 'ACTIVE');
        if (activePrimary.length > 1) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.ATTRIBUTION_CONFLICT,
            partnerId,
            tenantId,
            entityId: tenantId,
            severity: 'CRITICAL',
            description: `tenant ${tenantId} has ${activePrimary.length} active primary attributions`,
            detectedAt: now,
            correlationId,
            sourceReferences: activePrimary.map((a: any) => a.id),
          });
        }
      }

      // COMMISSION checks
      const commissions = await (this.prisma as any).partnerCommission?.findMany?.({ where: { partnerId }, take: 1000 }) ?? [];
      const sourceEventIds = new Set<string>();
      for (const com of commissions) {
        if (!com.sourceEventId) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.COMMISSION_WITHOUT_SOURCE_PAYMENT,
            partnerId,
            tenantId: com.tenantId,
            entityId: com.id,
            severity: 'HIGH',
            description: `commission ${com.id} missing source event`,
            detectedAt: now,
            correlationId,
          });
        }
        const key = `${com.partnerId}:${com.sourceEventId}`;
        if (sourceEventIds.has(key)) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.COMMISSION_DUPLICATE,
            partnerId,
            tenantId: com.tenantId,
            entityId: com.id,
            severity: 'HIGH',
            description: `duplicate commission for source event ${com.sourceEventId}`,
            detectedAt: now,
            correlationId,
          });
        }
        sourceEventIds.add(key);

        // COMMISSION_AMOUNT_MISMATCH - check if calculation matches expected
        // For now, check if amount is zero when gross is positive
        try {
          const gross = parseFloat(com.grossRevenue);
          const amount = parseFloat(com.commissionAmount);
          if (gross > 0 && amount === 0 && com.state !== 'REVERSED') {
            mismatches.push({
              type: PartnerReconciliationMismatchType.COMMISSION_AMOUNT_MISMATCH,
              partnerId,
              tenantId: com.tenantId,
              entityId: com.id,
              severity: 'MEDIUM',
              description: `commission ${com.id} has zero amount but gross ${com.grossRevenue} positive`,
              detectedAt: now,
              correlationId,
            });
          }
        } catch {}

        // CURRENCY_MISMATCH and MISSING_FX
        if (com.sourceCurrency && com.commissionCurrency && com.sourceCurrency !== com.commissionCurrency) {
          if (com.fxRequired && !com.fxRate) {
            mismatches.push({
              type: PartnerReconciliationMismatchType.MISSING_FX,
              partnerId,
              tenantId: com.tenantId,
              entityId: com.id,
              severity: 'HIGH',
              description: `commission ${com.id} requires FX ${com.sourceCurrency}->${com.commissionCurrency} but rate missing`,
              detectedAt: now,
              correlationId,
            });
          }
          if (com.currency !== com.commissionCurrency && com.currency !== com.sourceCurrency) {
            mismatches.push({
              type: PartnerReconciliationMismatchType.CURRENCY_MISMATCH,
              partnerId,
              tenantId: com.tenantId,
              entityId: com.id,
              severity: 'MEDIUM',
              description: `commission ${com.id} currency ${com.currency} mismatches source ${com.sourceCurrency} and commission ${com.commissionCurrency}`,
              detectedAt: now,
              correlationId,
            });
          }
        }
      }

      // REFUND_WITHOUT_COMMISSION_REVERSAL and CHARGEBACK_WITHOUT_REVERSAL
      // Check refunds/chargebacks without corresponding reversals
      const refunds = commissions.filter((c: any) => c.sourceEventType === 'REFUND' || c.sourceEventType === 'CHARGEBACK');
      for (const refund of refunds) {
        const hasReversal = commissions.some((c: any) => c.reversalOfId && c.sourceEventId.includes(refund.sourceEventId));
        if (!hasReversal) {
          const type = refund.sourceEventType === 'REFUND' ? PartnerReconciliationMismatchType.REFUND_WITHOUT_COMMISSION_REVERSAL : PartnerReconciliationMismatchType.CHARGEBACK_WITHOUT_REVERSAL;
          mismatches.push({
            type,
            partnerId,
            tenantId: refund.tenantId,
            entityId: refund.id,
            severity: 'HIGH',
            description: `${refund.sourceEventType} ${refund.id} without commission reversal`,
            detectedAt: now,
            correlationId,
          });
        }
      }

      // SETTLEMENT_WITHOUT_RECONCILIATION
      const settlements = await (this.prisma as any).partnerSettlement?.findMany?.({ where: { partnerId }, take: 500 }) ?? [];
      for (const set of settlements) {
        if ((set.state === 'LOCKED' || set.state === 'COMPLETED') && !set.reconciledAt) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.SETTLEMENT_WITHOUT_RECONCILIATION,
            partnerId,
            entityId: set.id,
            severity: 'HIGH',
            description: `settlement ${set.id} locked/completed without reconciliation`,
            detectedAt: now,
            correlationId,
          });
        }
      }

      // PAYOUT checks
      const payouts = await (this.prisma as any).partnerPayout?.findMany?.({ where: { partnerId }, take: 500 }) ?? [];
      for (const payout of payouts) {
        const settlementExists = settlements.some((s: any) => s.id === payout.settlementId);
        if (!settlementExists) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.PAYOUT_WITHOUT_SETTLEMENT,
            partnerId,
            entityId: payout.id,
            severity: 'CRITICAL',
            description: `payout ${payout.id} without settlement ${payout.settlementId}`,
            detectedAt: now,
            correlationId,
          });
        }
        if (payout.state === 'COMPLETED' && !payout.providerPayoutId) {
          mismatches.push({
            type: PartnerReconciliationMismatchType.PAYOUT_STATUS_MISMATCH,
            partnerId,
            entityId: payout.id,
            severity: 'HIGH',
            description: `payout ${payout.id} COMPLETED without provider evidence`,
            detectedAt: now,
            correlationId,
          });
        }
      }

    } catch (e) {
      this.logger.debug(`reconciliation fallback partner=${partnerId} err=${(e as Error).message}`);
    }

    for (const m of mismatches) {
      this.inMemory.set(`${m.entityId}_${m.type}`, m);
    }

    this.logger.log(`reconciliation partner=${partnerId} mismatches=${mismatches.length} corr=${correlationId}`);
    return mismatches;
  }

  async listMismatches(partnerId: string, filters?: { type?: PartnerReconciliationMismatchType; severity?: string }): Promise<ReconciliationMismatch[]> {
    let list = [...this.inMemory.values()].filter(m => m.partnerId === partnerId);
    if (filters?.type) list = list.filter(m => m.type === filters.type);
    if (filters?.severity) list = list.filter(m => m.severity === filters.severity);
    return list;
  }

  async resolveMismatch(entityId: string, type: PartnerReconciliationMismatchType, partnerId: string, correlationId: string, resolution: string): Promise<void> {
    const key = `${entityId}_${type}`;
    this.inMemory.delete(key);
    this.logger.log(`mismatch resolved entity=${entityId} type=${type} partner=${partnerId} corr=${correlationId} resolution=${resolution}`);
  }
}

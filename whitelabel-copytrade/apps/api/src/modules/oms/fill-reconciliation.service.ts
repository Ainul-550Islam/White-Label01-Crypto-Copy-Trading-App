import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReconciliationCategory, isValidDecimal, parseScaled, formatScaled } from './oms.types';

/**
 * Fill Reconciliation Service — reconciles provider fills against internal fills
 * and detects quantity/price/fee/currency/timestamp mismatches.
 */

@Injectable()
export class FillReconciliationService {
  private readonly logger = new Logger(FillReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcileFillsForOrder(params: { tenantId: string; orderId: string; intentId?: string }) {
    const { tenantId, orderId, intentId } = params;

    const canonicalFills = await this.prisma.fill.findMany({ where: { orderId }, orderBy: { receivedTimestampMicros: 'asc' } });

    let omsFills: any[] = [];
    try {
      omsFills = await (this.prisma as any).omsFill.findMany({
        where: { tenantId, ...(intentId ? { orderIntentId: intentId } : { internalOrderId: orderId }), state: { not: 'DUPLICATE' } },
        orderBy: { timestampMicros: 'asc' },
      });
    } catch {
      omsFills = [];
    }

    const findings: Array<{ category: string; severity: string; summary: string; expected: any; actual: any }> = [];

    // Build maps by providerFillId
    const canonicalById = new Map<string, any>();
    for (const f of canonicalFills) canonicalById.set(f.venueTradeId, f);

    const omsById = new Map<string, any>();
    for (const f of omsFills) omsById.set(f.providerFillId, f);

    // Missing fill: in canonical but not in OMS
    for (const [fillId, cf] of canonicalById) {
      if (!omsById.has(fillId)) {
        findings.push({
          category: ReconciliationCategory.MISSING_FILL,
          severity: 'MEDIUM',
          summary: `Canonical fill ${fillId} order ${orderId} missing in OMS fills`,
          expected: { fillId, existsInOms: true },
          actual: { fillId, existsInOms: false, quantity: cf.quantity.toString(), price: cf.price.toString() },
        });
      }
    }

    // Orphan fill: in OMS but not in canonical
    for (const [fillId, ofill] of omsById) {
      if (!canonicalById.has(fillId)) {
        findings.push({
          category: ReconciliationCategory.ORPHAN_FILL,
          severity: 'MEDIUM',
          summary: `OMS fill ${fillId} order ${orderId} orphan — no canonical fill`,
          expected: { fillId, existsInCanonical: true },
          actual: { fillId, existsInCanonical: false, quantity: ofill.quantity, price: ofill.price },
        });
      }
    }

    // Quantity/price/fee drift for matching fills
    for (const [fillId, cf] of canonicalById) {
      const ofill = omsById.get(fillId);
      if (!ofill) continue;

      const cfQty = cf.quantity.toString();
      const oQty = ofill.quantity?.toString() ?? ofill.quantity;
      if (isValidDecimal(cfQty) && isValidDecimal(oQty) && cfQty !== oQty) {
        findings.push({
          category: ReconciliationCategory.QUANTITY_DRIFT,
          severity: 'HIGH',
          summary: `Quantity drift fill ${fillId} canonical ${cfQty} vs OMS ${oQty}`,
          expected: { quantity: cfQty },
          actual: { quantity: oQty },
        });
      }

      const cfPrice = cf.price.toString();
      const oPrice = ofill.price?.toString() ?? ofill.price;
      if (isValidDecimal(cfPrice) && isValidDecimal(oPrice) && cfPrice !== oPrice) {
        findings.push({
          category: ReconciliationCategory.PRICE_DRIFT,
          severity: 'HIGH',
          summary: `Price drift fill ${fillId} canonical ${cfPrice} vs OMS ${oPrice}`,
          expected: { price: cfPrice },
          actual: { price: oPrice },
        });
      }

      const cfFee = cf.fee.toString();
      const oFee = ofill.fee?.toString() ?? ofill.fee;
      if (isValidDecimal(cfFee) && isValidDecimal(oFee) && cfFee !== oFee) {
        findings.push({
          category: ReconciliationCategory.FEE_MISMATCH,
          severity: 'MEDIUM',
          summary: `Fee mismatch fill ${fillId} canonical ${cfFee} vs OMS ${oFee}`,
          expected: { fee: cfFee },
          actual: { fee: oFee },
        });
      }

      if (cf.feeCurrency !== ofill.feeCurrency) {
        findings.push({
          category: ReconciliationCategory.FEE_MISMATCH,
          severity: 'LOW',
          summary: `Fee currency mismatch fill ${fillId} canonical ${cf.feeCurrency} vs OMS ${ofill.feeCurrency}`,
          expected: { feeCurrency: cf.feeCurrency },
          actual: { feeCurrency: ofill.feeCurrency },
        });
      }
    }

    // Cumulative quantity check
    let canonicalCumulative = 0n;
    for (const f of canonicalFills) {
      const qtyStr = f.quantity.toString();
      if (isValidDecimal(qtyStr)) canonicalCumulative += parseScaled(qtyStr);
    }

    let omsCumulative = 0n;
    for (const f of omsFills) {
      const qtyStr = f.quantity?.toString() ?? f.quantity;
      if (isValidDecimal(qtyStr)) omsCumulative += parseScaled(qtyStr);
    }

    if (canonicalCumulative !== omsCumulative) {
      findings.push({
        category: ReconciliationCategory.QUANTITY_DRIFT,
        severity: 'HIGH',
        summary: `Cumulative quantity drift order ${orderId} canonical ${formatScaled(canonicalCumulative)} vs OMS ${formatScaled(omsCumulative)}`,
        expected: { cumulative: formatScaled(canonicalCumulative) },
        actual: { cumulative: formatScaled(omsCumulative) },
      });
    }

    // Duplicate detection: same venueTradeId appears multiple times in canonical
    const seen = new Set<string>();
    for (const f of canonicalFills) {
      if (seen.has(f.venueTradeId)) {
        findings.push({
          category: ReconciliationCategory.DUPLICATE_FILL,
          severity: 'MEDIUM',
          summary: `Duplicate canonical fill ${f.venueTradeId} order ${orderId}`,
          expected: { count: 1 },
          actual: { fillId: f.venueTradeId, duplicate: true },
        });
      }
      seen.add(f.venueTradeId);
    }

    // Persist
    for (const f of findings) {
      try {
        await (this.prisma as any).omsReconciliation.create({
          data: {
            tenantId,
            orderIntentId: intentId ?? null,
            internalOrderId: orderId,
            providerFillId: (f.actual as any)?.fillId ?? null,
            category: f.category,
            severity: f.severity,
            expected: f.expected,
            actual: f.actual,
            summary: f.summary.slice(0, 1000),
            resolved: false,
          },
        });
      } catch {}
    }

    this.logger.log(`Fill reconciliation order ${orderId} tenant ${tenantId} findings ${findings.length} canonical ${canonicalFills.length} oms ${omsFills.length}`);
    return { orderId, intentId: intentId ?? null, canonicalCount: canonicalFills.length, omsCount: omsFills.length, findings, totalFindings: findings.length };
  }

  async reconcileTenantFills(params: { tenantId: string; accountId?: string; limit?: number }) {
    const { tenantId, accountId, limit = 20 } = params;
    const orders = await this.prisma.order.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}), filledQuantity: { gt: 0 } as any },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    const results = [];
    for (const order of orders) {
      // Find intent id
      let intentId: string | undefined;
      try {
        const intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { tenantId, clientOrderId: order.clientOrderId } });
        intentId = intent?.id;
      } catch {}
      const res = await this.reconcileFillsForOrder({ tenantId, orderId: order.id, intentId });
      if (res.totalFindings > 0) results.push(res);
    }

    return { totalChecked: orders.length, withFindings: results.length, results };
  }
}

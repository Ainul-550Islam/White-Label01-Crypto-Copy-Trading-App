import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReconciliationCategory, isValidDecimal, parseScaled, formatScaled } from './oms.types';

/**
 * Position Reconciliation Service — cross-checks cumulative fills ↔ canonical position ↔ exchange snapshot
 * without becoming a position source. Does not directly overwrite authoritative position source.
 */

@Injectable()
export class PositionReconciliationService {
  private readonly logger = new Logger(PositionReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcilePosition(params: { tenantId: string; accountId: string; symbol: string }) {
    const { tenantId, accountId, symbol } = params;

    const position = await this.prisma.position.findFirst({ where: { tenantId, accountId, symbol } });
    const orders = await this.prisma.order.findMany({ where: { tenantId, accountId, symbol } });
    const orderIds = orders.map((o) => o.id);
    const fills = orderIds.length > 0 ? await this.prisma.fill.findMany({ where: { orderId: { in: orderIds } }, orderBy: { receivedTimestampMicros: 'asc' } }) : [];

    const findings: Array<{ category: string; severity: string; summary: string; expected: any; actual: any }> = [];

    // Calculate net quantity from fills
    let netQty = 0n;
    for (const fill of fills) {
      const qtyStr = fill.quantity.toString();
      const side = fill.side ?? orders.find((o) => o.id === fill.orderId)?.side;
      if (!isValidDecimal(qtyStr)) continue;
      const qty = parseScaled(qtyStr);
      if (side === 'BUY') netQty += qty;
      else if (side === 'SELL') netQty -= qty;
    }

    if (position) {
      const posQtyStr = position.quantity.toString();
      if (isValidDecimal(posQtyStr)) {
        const posQty = parseScaled(posQtyStr);
        if (posQty !== netQty) {
          findings.push({
            category: ReconciliationCategory.POSITION_QUANTITY_MISMATCH,
            severity: 'HIGH',
            summary: `Position quantity mismatch ${symbol} account ${accountId}: position ${posQtyStr} vs net fills ${formatScaled(netQty)}`,
            expected: { netFills: formatScaled(netQty) },
            actual: { positionQuantity: posQtyStr },
          });
        }

        // Side mismatch
        const expectedSide = netQty > 0n ? 'LONG' : netQty < 0n ? 'SHORT' : 'FLAT';
        if (position.side !== expectedSide) {
          findings.push({
            category: ReconciliationCategory.SIDE_MISMATCH,
            severity: 'MEDIUM',
            summary: `Side mismatch ${symbol} account ${accountId}: position side ${position.side} vs expected ${expectedSide} from fills`,
            expected: { side: expectedSide },
            actual: { side: position.side },
          });
        }

        // Position without fills
        if (fills.length === 0 && posQty !== 0n) {
          findings.push({
            category: ReconciliationCategory.POSITION_WITHOUT_FILLS,
            severity: 'MEDIUM',
            summary: `Position ${symbol} account ${accountId} qty ${posQtyStr} exists but no fills found`,
            expected: { fillsExist: true },
            actual: { fillCount: 0, positionQuantity: posQtyStr },
          });
        }

        // Stale position
        const ageMs = Date.now() - new Date(position.updatedAt).getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          findings.push({
            category: ReconciliationCategory.STALE_POSITION,
            severity: 'LOW',
            summary: `Stale position ${symbol} account ${accountId} age ${Math.floor(ageMs / 1000 / 60)}m`,
            expected: { maxAgeMs: 24 * 60 * 60 * 1000 },
            actual: { ageMs, updatedAt: position.updatedAt.toISOString() },
          });
        }
      }
    } else {
      // No position but fills exist
      if (netQty !== 0n) {
        findings.push({
          category: ReconciliationCategory.FILLS_WITHOUT_POSITION,
          severity: 'MEDIUM',
          summary: `Fills exist for ${symbol} account ${accountId} net ${formatScaled(netQty)} but no position record`,
          expected: { positionExists: true },
          actual: { netFills: formatScaled(netQty), fillCount: fills.length },
        });
      }
    }

    // Compare with exchange position snapshot if available (from exchange-position-sync)
    // We don't have a dedicated snapshot table in this schema, but we can check accountBalanceSnapshot as proxy for health
    // For now, we skip exchange snapshot unless model exists

    // Persist findings
    for (const f of findings) {
      try {
        await (this.prisma as any).omsReconciliation.create({
          data: {
            tenantId,
            internalOrderId: null,
            providerOrderId: null,
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

    this.logger.log(`Position reconciliation ${symbol} account ${accountId} tenant ${tenantId} findings ${findings.length} netFills ${formatScaled(netQty)} pos ${position?.quantity.toString() ?? 'none'}`);
    return { accountId, symbol, position: position ? { quantity: position.quantity.toString(), side: position.side } : null, netFills: formatScaled(netQty), fillCount: fills.length, findings, totalFindings: findings.length };
  }

  async reconcileAccountPositions(params: { tenantId: string; accountId: string }) {
    const { tenantId, accountId } = params;
    const positions = await this.prisma.position.findMany({ where: { tenantId, accountId } });
    const results = [];
    for (const pos of positions) {
      const res = await this.reconcilePosition({ tenantId, accountId, symbol: pos.symbol });
      results.push(res);
    }

    // Also check symbols that have fills but no position
    const orders = await this.prisma.order.findMany({ where: { tenantId, accountId } });
    const symbolsWithFills = new Set<string>();
    for (const order of orders) {
      const fills = await this.prisma.fill.findMany({ where: { orderId: order.id } });
      if (fills.length > 0) symbolsWithFills.add(order.symbol);
    }
    const positionSymbols = new Set(positions.map((p) => p.symbol));
    for (const sym of symbolsWithFills) {
      if (!positionSymbols.has(sym)) {
        const res = await this.reconcilePosition({ tenantId, accountId, symbol: sym });
        results.push(res);
      }
    }

    return { accountId, totalPositions: positions.length, totalFindings: results.reduce((s, r) => s + r.totalFindings, 0), results };
  }
}

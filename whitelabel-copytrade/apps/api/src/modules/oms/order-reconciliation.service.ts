import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReconciliationCategory, isValidDecimal, parseScaled, formatScaled } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Order Reconciliation Service — reconciles OMS intent ↔ execution engine ↔ exchange order ↔ fills ↔ positions
 * and identifies missing/duplicate/stale/mismatched state.
 * Never silently rewrites order history.
 */

@Injectable()
export class OrderReconciliationService {
  private readonly logger = new Logger(OrderReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcileOrder(params: { tenantId: string; intentId: string }) {
    const { tenantId, intentId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const findings: Array<{ category: string; severity: string; summary: string; expected: any; actual: any }> = [];

    const clientOrderId = intent.clientOrderId;
    const exchangeOrderId = intent.exchangeOrderId ?? intent.exchangeOrderId;
    const currentState = intent.state ?? intent.status;

    // Fetch canonical order by clientOrderId
    const canonicalOrder = await this.prisma.order.findFirst({ where: { tenantId, clientOrderId } });
    if (!canonicalOrder) {
      findings.push({
        category: ReconciliationCategory.MISSING_EXCHANGE_ORDER,
        severity: 'HIGH',
        summary: `OMS intent ${intentId} clientOrderId ${clientOrderId} has no canonical Order record`,
        expected: { canonicalOrderExists: true },
        actual: { clientOrderId, found: false },
      });
    } else {
      // Check exchangeOrderId presence
      if (!canonicalOrder.exchangeOrderId && ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'].includes(currentState)) {
        findings.push({
          category: ReconciliationCategory.MISSING_EXCHANGE_ORDER,
          severity: 'MEDIUM',
          summary: `Intent ${intentId} state ${currentState} but canonical order ${canonicalOrder.id} has no exchangeOrderId`,
          expected: { exchangeOrderIdExists: true },
          actual: { state: currentState, exchangeOrderId: null },
        });
      }

      // Check ack
      if (!canonicalOrder.exchangeOrderId && currentState === 'SUBMITTED') {
        // Check if ack exists in execution events
        const ackEvent = await this.prisma.orderEvent.findFirst({ where: { orderId: canonicalOrder.id, status: { in: ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'] as any } } });
        if (!ackEvent) {
          findings.push({
            category: ReconciliationCategory.MISSING_ACK,
            severity: 'MEDIUM',
            summary: `Intent ${intentId} SUBMITTED but no ack event for canonical order ${canonicalOrder.id}`,
            expected: { ackExists: true },
            actual: { state: currentState, ackFound: false },
          });
        }
      }

      // Provider status mismatch
      if (canonicalOrder && (canonicalOrder.status as any) !== currentState) {
        // Allow some valid differences: OMS SUBMITTED vs canonical ACKNOWLEDGED is okay (timing)
        const validMismatch = (currentState === 'SUBMITTED' && ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'].includes(canonicalOrder.status as any)) ||
          (currentState === 'ACKNOWLEDGED' && ['PARTIALLY_FILLED', 'FILLED'].includes(canonicalOrder.status as any));
        if (!validMismatch) {
          findings.push({
            category: ReconciliationCategory.PROVIDER_STATUS_MISMATCH,
            severity: currentState === 'FILLED' || canonicalOrder.status === 'FILLED' ? 'HIGH' : 'MEDIUM',
            summary: `Status mismatch intent ${intentId} OMS ${currentState} vs canonical ${canonicalOrder.status}`,
            expected: { omsState: currentState },
            actual: { canonicalStatus: canonicalOrder.status },
          });
        }
      }

      // Quantity mismatch
      const intentQty = intent.quantity?.toString() ?? intent.quantity;
      const canonicalQty = canonicalOrder.quantity.toString();
      if (isValidDecimal(intentQty) && isValidDecimal(canonicalQty) && intentQty !== canonicalQty) {
        findings.push({
          category: ReconciliationCategory.ORDER_QUANTITY_MISMATCH,
          severity: 'HIGH',
          summary: `Quantity mismatch intent ${intentId} OMS ${intentQty} vs canonical ${canonicalQty}`,
          expected: { quantity: intentQty },
          actual: { quantity: canonicalQty },
        });
      }

      // Terminal state mismatch
      const omsTerminal = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'REPLACED'].includes(currentState);
      const canonicalTerminal = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'FAILED'].includes(canonicalOrder.status as any);
      if (omsTerminal !== canonicalTerminal) {
        findings.push({
          category: ReconciliationCategory.TERMINAL_STATE_MISMATCH,
          severity: 'MEDIUM',
          summary: `Terminal mismatch intent ${intentId} OMS terminal ${omsTerminal} state ${currentState} vs canonical terminal ${canonicalTerminal} state ${canonicalOrder.status}`,
          expected: { omsTerminal },
          actual: { canonicalTerminal, canonicalStatus: canonicalOrder.status },
        });
      }

      // Stale order detection: SUBMITTED/ACKNOWLEDGED for > 5 minutes without update
      if (['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'].includes(currentState)) {
        const updatedAt = intent.updatedAt ? new Date(intent.updatedAt) : new Date(intent.createdAt);
        const ageMs = Date.now() - updatedAt.getTime();
        if (ageMs > 5 * 60 * 1000) {
          findings.push({
            category: ReconciliationCategory.STALE_ORDER,
            severity: ageMs > 30 * 60 * 1000 ? 'HIGH' : 'MEDIUM',
            summary: `Stale order intent ${intentId} state ${currentState} age ${Math.floor(ageMs / 1000)}s`,
            expected: { maxAgeMs: 5 * 60 * 1000 },
            actual: { ageMs, state: currentState },
          });
        }
      }

      // Duplicate provider order: same clientOrderId appears multiple times
      const dupOrders = await this.prisma.order.findMany({ where: { tenantId, clientOrderId } });
      if (dupOrders.length > 1) {
        findings.push({
          category: ReconciliationCategory.DUPLICATE_PROVIDER_ORDER,
          severity: 'HIGH',
          summary: `Duplicate provider orders for clientOrderId ${clientOrderId} count ${dupOrders.length}`,
          expected: { count: 1 },
          actual: { count: dupOrders.length, orderIds: dupOrders.map((o) => o.id) },
        });
      }

      // Impossible lifecycle transition check via transitions
      const transitions = (intent.metadata?.transitions as any[]) ?? [];
      for (let i = 1; i < transitions.length; i++) {
        const from = transitions[i - 1].toState;
        const to = transitions[i].toState;
        // Use same VALID_TRANSITIONS check
        const { isValidTransition } = require('./oms.types');
        if (!isValidTransition(from, to)) {
          findings.push({
            category: ReconciliationCategory.IMPOSSIBLE_LIFECYCLE_TRANSITION,
            severity: 'HIGH',
            summary: `Impossible transition ${from} → ${to} in intent ${intentId} at ${transitions[i].timestamp}`,
            expected: { valid: true },
            actual: { from, to, eventId: transitions[i].eventId },
          });
        }
      }
    }

    // Persist findings
    for (const f of findings) {
      try {
        await (this.prisma as any).omsReconciliation.create({
          data: {
            tenantId,
            orderIntentId: intentId,
            internalOrderId: canonicalOrder?.id ?? null,
            providerOrderId: exchangeOrderId ?? null,
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

    this.logger.log(`Order reconciliation intent ${intentId} tenant ${tenantId} findings ${findings.length}`);
    return { intentId, findings, totalFindings: findings.length, timestamp: new Date().toISOString() };
  }

  async reconcileTenant(params: { tenantId: string; accountId?: string; limit?: number }) {
    const { tenantId, accountId, limit = 20 } = params;
    let intents: any[] = [];
    try {
      intents = await (this.prisma as any).omsOrderIntent.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), state: { in: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'RECONCILIATION_REQUIRED'] } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
    } catch {
      intents = await this.prisma.order.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), status: { in: ['SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED'] as any } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      });
    }

    const results = [];
    for (const intent of intents) {
      const res = await this.reconcileOrder({ tenantId, intentId: intent.id });
      results.push(res);
    }
    return { totalChecked: intents.length, totalFindings: results.reduce((s, r) => s + r.totalFindings, 0), results };
  }
}

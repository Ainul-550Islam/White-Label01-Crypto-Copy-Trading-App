import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Execution Latency Service — measures signal→intent, intent→submit, submit→ack, ack→fill, first→complete, total
 * Requirements: synchronized timestamp handling, clock skew detection, missing timestamp handling, no fabricated latency.
 */

@Injectable()
export class ExecutionLatencyService {
  private readonly logger = new Logger(ExecutionLatencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private parseMicros(microsStr: string | null | undefined): bigint | null {
    if (!microsStr) return null;
    try {
      // Could be decimal string scaled or integer micros
      if (microsStr.includes('.')) {
        // scaled decimal
        const parts = microsStr.split('.');
        const intPart = BigInt(parts[0]);
        const frac = (parts[1] + '0'.repeat(12)).slice(0, 12);
        // This is 1e12 scaled, not micros — but we need to convert to micros
        // If it looks like scaled decimal with value < 1e6, it's likely already micros as integer string
        // We'll treat integer string as micros directly
        return null;
      }
      return BigInt(microsStr);
    } catch {
      return null;
    }
  }

  private microsToMs(micros: bigint): string {
    // micros to ms with 3 decimal precision as string
    const ms = Number(micros) / 1000;
    return ms.toFixed(3);
  }

  private diffMs(a: bigint | null, b: bigint | null): string | null {
    if (a === null || b === null) return null;
    if (b < a) return null; // negative would indicate clock skew or out-of-order, handled separately
    return this.microsToMs(b - a);
  }

  async calculateForIntent(params: { tenantId: string; intentId: string }) {
    const { tenantId, intentId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const transitions = (intent.metadata?.transitions as any[]) ?? [];
    const signalTimestamp = intent.signalId ? (intent.metadata?.signalTimestamp as string | null) ?? null : null;
    // We don't have signal timestamp in DB, try to find from strategy run or copy execution
    let signalMicros: bigint | null = null;
    let intentMicros: bigint | null = null;
    let submitMicros: bigint | null = null;
    let ackMicros: bigint | null = null;
    let firstFillMicros: bigint | null = null;
    let completeFillMicros: bigint | null = null;

    const missing: string[] = [];

    // Intent timestamp = CREATED transition
    const createdTransition = transitions.find((t: any) => t.toState === 'CREATED') ?? transitions[0];
    if (createdTransition?.timestampMicros) {
      intentMicros = this.parseMicros(createdTransition.timestampMicros);
    } else if (intent.createdAt) {
      intentMicros = BigInt(new Date(intent.createdAt).getTime()) * 1000n;
    } else {
      missing.push('intentTimestamp');
    }

    // Signal timestamp — try to get from metadata or copy execution
    if (intent.metadata?.signalTimestampMicros) {
      signalMicros = this.parseMicros(intent.metadata.signalTimestampMicros as string);
    } else if (signalTimestamp) {
      try {
        signalMicros = BigInt(new Date(signalTimestamp).getTime()) * 1000n;
      } catch {
        missing.push('signalTimestamp');
      }
    } else {
      missing.push('signalTimestamp');
    }

    // Submit timestamp
    const submitTransition = transitions.find((t: any) => t.toState === 'SUBMITTED');
    if (submitTransition?.timestampMicros) {
      submitMicros = this.parseMicros(submitTransition.timestampMicros);
    } else if (intent.submittedAt) {
      submitMicros = BigInt(new Date(intent.submittedAt).getTime()) * 1000n;
    } else {
      missing.push('submitTimestamp');
    }

    // Ack timestamp
    const ackTransition = transitions.find((t: any) => t.toState === 'ACKNOWLEDGED');
    if (ackTransition?.timestampMicros) {
      ackMicros = this.parseMicros(ackTransition.timestampMicros);
    } else {
      try {
        const ack = await (this.prisma as any).omsExecutionAck.findFirst({ where: { tenantId, orderIntentId: intentId }, orderBy: { timestampMicros: 'asc' } });
        if (ack?.timestampMicros) ackMicros = this.parseMicros(ack.timestampMicros);
        else missing.push('ackTimestamp');
      } catch {
        missing.push('ackTimestamp');
      }
    }

    // First fill and complete fill
    try {
      const fills = await (this.prisma as any).omsFill.findMany({ where: { tenantId, orderIntentId: intentId }, orderBy: { timestampMicros: 'asc' } });
      if (fills.length > 0) {
        firstFillMicros = this.parseMicros(fills[0].timestampMicros ?? fills[0].receivedTimestampMicros);
        const lastFill = fills[fills.length - 1];
        // Only set complete if intent is FILLED
        const currentState = intent.state ?? intent.status;
        if (currentState === 'FILLED') {
          completeFillMicros = this.parseMicros(lastFill.timestampMicros ?? lastFill.receivedTimestampMicros);
        }
      } else {
        missing.push('firstFillTimestamp');
        missing.push('completeFillTimestamp');
      }
    } catch {
      // fallback to canonical fills
      try {
        const canonicalFills = await this.prisma.fill.findMany({ where: { orderId: intent.internalOrderId ?? intentId }, orderBy: { receivedTimestampMicros: 'asc' } });
        if (canonicalFills.length > 0) {
          firstFillMicros = canonicalFills[0].receivedTimestampMicros;
          const currentState = intent.state ?? intent.status;
          if (currentState === 'FILLED') completeFillMicros = canonicalFills[canonicalFills.length - 1].receivedTimestampMicros;
        } else {
          missing.push('firstFillTimestamp');
        }
      } catch {
        missing.push('firstFillTimestamp');
      }
    }

    // Clock skew detection: any timestamp going backwards
    let clockSkewDetected = false;
    const ordered = [signalMicros, intentMicros, submitMicros, ackMicros, firstFillMicros, completeFillMicros].filter((v) => v !== null) as bigint[];
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i] < ordered[i - 1]) {
        clockSkewDetected = true;
        this.logger.warn(`Clock skew detected for intent ${intentId} tenant ${tenantId}: timestamp ${i} < ${i - 1}`);
        break;
      }
    }

    const metrics = {
      id: randomUUID(),
      tenantId,
      orderIntentId: intentId,
      signalTimestamp: signalMicros ? new Date(Number(signalMicros / 1000n)).toISOString() : null,
      intentTimestamp: intentMicros ? new Date(Number(intentMicros / 1000n)).toISOString() : intent.createdAt ?? new Date().toISOString(),
      submitTimestamp: submitMicros ? new Date(Number(submitMicros / 1000n)).toISOString() : null,
      ackTimestamp: ackMicros ? new Date(Number(ackMicros / 1000n)).toISOString() : null,
      firstFillTimestamp: firstFillMicros ? new Date(Number(firstFillMicros / 1000n)).toISOString() : null,
      completeFillTimestamp: completeFillMicros ? new Date(Number(completeFillMicros / 1000n)).toISOString() : null,
      signalToIntentMs: this.diffMs(signalMicros, intentMicros),
      intentToSubmitMs: this.diffMs(intentMicros, submitMicros),
      submitToAckMs: this.diffMs(submitMicros, ackMicros),
      ackToFirstFillMs: this.diffMs(ackMicros, firstFillMicros),
      firstFillToCompleteMs: this.diffMs(firstFillMicros, completeFillMicros),
      totalLatencyMs: this.diffMs(signalMicros ?? intentMicros, completeFillMicros ?? firstFillMicros ?? ackMicros ?? submitMicros),
      clockSkewDetected,
      missingTimestamps: missing,
      calculatedAt: new Date().toISOString(),
    };

    // Persist if model exists
    try {
      await (this.prisma as any).omsExecutionLatency.create({ data: { ...metrics, signalTimestampMicros: signalMicros?.toString() ?? null, intentTimestampMicros: intentMicros?.toString() ?? null, submitTimestampMicros: submitMicros?.toString() ?? null, ackTimestampMicros: ackMicros?.toString() ?? null, firstFillTimestampMicros: firstFillMicros?.toString() ?? null, completeFillTimestampMicros: completeFillMicros?.toString() ?? null } });
    } catch {}

    return metrics;
  }
}

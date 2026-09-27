import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isValidDecimal, parseScaled, formatScaled } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Venue Execution Score Service — creates explainable venue performance metrics.
 * Inputs: latency, fill ratio, slippage, rejection rate, provider errors, rate limits, stale data.
 * No subjective hidden scoring. Output contains metric values, methodology, observation count, period, venue.
 */

@Injectable()
export class VenueExecutionScoreService {
  private readonly logger = new Logger(VenueExecutionScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateForVenue(params: {
    tenantId: string;
    venue: string;
    from: Date;
    to: Date;
    accountId?: string | null;
  }) {
    const { tenantId, venue, from, to, accountId } = params;

    let intents: any[] = [];
    try {
      intents = await (this.prisma as any).omsOrderIntent.findMany({
        where: { tenantId, venue, ...(accountId ? { accountId } : {}), createdAt: { gte: from, lte: to } },
      });
    } catch {
      intents = await this.prisma.order.findMany({
        where: { tenantId, venue: venue as any, ...(accountId ? { accountId } : {}), createdAt: { gte: from, lte: to } },
      });
    }

    const totalOrders = intents.length;
    const filledOrders = intents.filter((o) => (o.state ?? o.status) === 'FILLED').length;
    const rejectedOrders = intents.filter((o) => (o.state ?? o.status) === 'REJECTED').length;

    const fillRatio = totalOrders > 0 ? filledOrders / totalOrders : null;
    const rejectionRate = totalOrders > 0 ? rejectedOrders / totalOrders : null;

    // Latency
    let latencySum = 0;
    let latencyCount = 0;
    const latencies: number[] = [];
    try {
      const acks = await (this.prisma as any).omsExecutionAck.findMany({ where: { tenantId, venue, createdAt: { gte: from, lte: to } } });
      for (const ack of acks) {
        if (ack.latencyMicros) {
          const micros = parseInt(ack.latencyMicros, 10);
          if (!isNaN(micros)) {
            const ms = micros / 1000;
            latencySum += ms;
            latencyCount++;
            latencies.push(ms);
          }
        }
      }
    } catch {}

    latencies.sort((a, b) => a - b);
    const avgLatency = latencyCount > 0 ? latencySum / latencyCount : null;
    const medianLatency = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;
    const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] : null;

    // Slippage
    let slippageSum = 0;
    let slippageCount = 0;
    try {
      const fills = await (this.prisma as any).omsFill.findMany({ where: { tenantId, venue, timestamp: { gte: from.toISOString(), lte: to.toISOString() } as any } });
      for (const fill of fills) {
        const intent = intents.find((i) => i.id === fill.orderIntentId);
        if (!intent) continue;
        const intendedPriceStr = intent.price?.toString() ?? intent.price;
        const fillPriceStr = fill.price?.toString() ?? fill.price;
        if (!intendedPriceStr || !fillPriceStr) continue;
        if (!isValidDecimal(intendedPriceStr) || !isValidDecimal(fillPriceStr)) continue;
        const intended = Number(parseScaled(intendedPriceStr)) / 1e12;
        const actual = Number(parseScaled(fillPriceStr)) / 1e12;
        if (intended === 0) continue;
        const slip = intent.side === 'BUY' ? ((actual - intended) / intended) * 100 : ((intended - actual) / intended) * 100;
        slippageSum += slip;
        slippageCount++;
      }
    } catch {}

    const avgSlippage = slippageCount > 0 ? slippageSum / slippageCount : null;

    // Provider errors, rate limits, stale data from rejection records
    let providerErrorCount = 0;
    let rateLimitCount = 0;
    let staleDataCount = 0;
    try {
      const rejections = await (this.prisma as any).omsRejection.findMany({ where: { tenantId, venue, timestamp: { gte: from.toISOString(), lte: to.toISOString() } as any } });
      for (const r of rejections) {
        if (r.category === 'EXCHANGE_REJECT') providerErrorCount++;
        if (r.category === 'RATE_LIMITED') rateLimitCount++;
        if (r.category === 'MARKET_DATA_STALE') staleDataCount++;
      }
    } catch {
      // fallback to Order rejectionCode
      for (const intent of intents) {
        if ((intent.state ?? intent.status) === 'REJECTED') {
          const cat = (intent.metadata as any)?.rejectionCategory ?? intent.rejectionCategory;
          if (cat === 'EXCHANGE_REJECT') providerErrorCount++;
          if (cat === 'RATE_LIMITED') rateLimitCount++;
          if (cat === 'MARKET_DATA_STALE') staleDataCount++;
        }
      }
    }

    const score = {
      id: randomUUID(),
      tenantId,
      venue,
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      totalOrders,
      filledOrders,
      rejectedOrders,
      averageLatencyMs: avgLatency !== null ? avgLatency.toFixed(3) : null,
      medianLatencyMs: medianLatency !== null ? medianLatency.toFixed(3) : null,
      p95LatencyMs: p95Latency !== null ? p95Latency.toFixed(3) : null,
      fillRatio: fillRatio !== null ? fillRatio.toFixed(6) : null,
      rejectionRate: rejectionRate !== null ? rejectionRate.toFixed(6) : null,
      averageSlippage: avgSlippage !== null ? avgSlippage.toFixed(6) : null,
      providerErrorCount,
      rateLimitCount,
      staleDataCount,
      methodology: 'EXPLAINABLE_METRICS: fillRatio = filled/total, rejectionRate = rejected/total, latency = submit→ack micros, slippage = (fill-intended)/intended*100 per side, errors counted from rejection categories',
      observationCount: totalOrders,
      scoreComponents: {
        fillRatio: fillRatio !== null ? fillRatio.toFixed(6) : null,
        rejectionRate: rejectionRate !== null ? rejectionRate.toFixed(6) : null,
        avgLatencyMs: avgLatency !== null ? avgLatency.toFixed(3) : null,
        avgSlippage: avgSlippage !== null ? avgSlippage.toFixed(6) : null,
        providerErrorCount: providerErrorCount.toString(),
        rateLimitCount: rateLimitCount.toString(),
        staleDataCount: staleDataCount.toString(),
      },
      note: 'Venue execution score is measurable and explainable, not subjective. Higher fillRatio and lower latency/slippage/rejection indicate better execution. Observation count shows sample size.',
      calculatedAt: new Date().toISOString(),
    };

    try {
      await (this.prisma as any).omsVenueScore.create({ data: score });
    } catch {}

    this.logger.log(`Venue score calculated venue ${venue} tenant ${tenantId} orders ${totalOrders} fillRatio ${fillRatio} avgLatency ${avgLatency}`);
    return score;
  }

  async listVenueScores(params: { tenantId: string; from?: Date; to?: Date }) {
    const { tenantId, from, to } = params;
    try {
      return await (this.prisma as any).omsVenueScore.findMany({
        where: { tenantId, ...(from || to ? { periodStart: { gte: from?.toISOString(), lte: to?.toISOString() } as any } : {}) },
        orderBy: { calculatedAt: 'desc' },
        take: 100,
      });
    } catch {
      return [];
    }
  }
}

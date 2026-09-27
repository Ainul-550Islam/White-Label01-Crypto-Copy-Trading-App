/**
 * Deterministic application-level analytics computed ONLY from
 * backend-observed data: the authoritative usage rollup and persisted
 * webhook delivery rows. Client claims cannot influence any number here.
 *
 * p95 is produced only when at least MIN_P95_OBSERVATIONS latency
 * observations exist; below that the field is null rather than invented.
 */

import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeveloperUsageService, DEVELOPER_METER_KEYS, type UsageRollup } from './developer-usage.service';

export const MIN_P95_OBSERVATIONS = 20;

export interface LatencyObservation {
  endpoint: string;
  apiVersion: string;
  latencyMs: number;
  outcome: 'ok' | '4xx' | '5xx' | 'rate_limited';
}

export interface DeveloperAnalytics {
  applicationId: string;
  window: { from: string; to: string };
  requests: number;
  successes: number;
  errors: number;
  errors4xx: number;
  errors5xx: number;
  rateLimitHits: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  webhookDeliveries: number;
  webhookFailures: number;
  activeApplications: number;
  topEndpoints: { endpoint: string; requests: number }[];
  apiVersionUsage: { version: string; requests: number }[];
  usage: UsageRollup;
}

@Injectable()
export class DeveloperAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: DeveloperUsageService,
  ) {}

  /** Pure percentile over an ascending-sortable numeric array. */
  percentile(values: number[], p: number): number | null {
    if (values.length < MIN_P95_OBSERVATIONS) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, index)];
  }

  average(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  async applicationAnalytics(input: {
    tenantId: string;
    applicationId: string;
    from: Date;
    to: Date;
    latencyObservations: LatencyObservation[];
  }): Promise<DeveloperAnalytics> {
    const application = await this.prisma.developerApplication.findUnique({
      where: { id: input.applicationId },
    });
    if (!application || application.tenantId !== input.tenantId) {
      throw new NotFoundException('developer application not found');
    }
    const usage = await this.usage.rollup(input.tenantId, {
      applicationId: input.applicationId,
      from: input.from,
      to: input.to,
      granularity: 'hour',
    });

    const latencies = input.latencyObservations.map((observation) => observation.latencyMs);
    const errors4xx = usage.byEndpoint.reduce((sum, endpoint) => sum + endpoint.errors4xx, 0);
    const errors5xx = usage.byEndpoint.reduce((sum, endpoint) => sum + endpoint.errors5xx, 0);
    const rateLimited = usage.totalRateLimited;
    const successes = Math.max(0, usage.totalRequests - errors4xx - errors5xx - rateLimited);

    const deliveryRows = await this.prisma.developerWebhookDelivery.findMany({
      where: {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        createdAt: { gte: input.from, lte: input.to },
      },
      select: { state: true },
      take: 50_000,
    });
    const deliveries = deliveryRows.length;
    const failures = deliveryRows.filter(
      (row: { state: string }) => row.state === 'FAILED' || row.state === 'EXHAUSTED',
    ).length;

    const activeApplications = await this.prisma.developerApplication.count({
      where: { tenantId: input.tenantId, state: 'ACTIVE' },
    });

    return {
      applicationId: input.applicationId,
      window: { from: input.from.toISOString(), to: input.to.toISOString() },
      requests: usage.totalRequests,
      successes,
      errors: errors4xx + errors5xx,
      errors4xx,
      errors5xx,
      rateLimitHits: rateLimited,
      averageLatencyMs: this.average(latencies),
      p95LatencyMs: this.percentile(latencies, 95),
      webhookDeliveries: deliveries || usage.totalWebhookDeliveries,
      webhookFailures: failures || usage.totalWebhookFailures,
      activeApplications,
      topEndpoints: usage.byEndpoint.slice(0, 10).map((endpoint) => ({
        endpoint: endpoint.endpoint,
        requests: endpoint.requests,
      })),
      apiVersionUsage: usage.byApiVersion,
      usage,
    };
  }

  /** Meter keys surfaced for documentation/tests (authoritative names). */
  meterKeys(): string[] {
    return Object.values(DEVELOPER_METER_KEYS);
  }
}

/**
 * Developer usage aggregation over the EXISTING UsageModule meters.
 *
 * This service NEVER creates a second authoritative meter: it reads
 * UsageEvent/UsageMeter rows (meter keys `developer_api_requests`,
 * `developer_rate_limited`, `developer_webhook_deliveries`) that the API
 * layer records through the usage module's own idempotency rules, and
 * aggregates them for the portal/analytics. Duplicate usage events are
 * impossible to double-count because UsageEvent.idempotencyKey is unique.
 */

import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export const DEVELOPER_METER_KEYS = {
  apiRequests: 'developer_api_requests',
  rateLimited: 'developer_rate_limited',
  webhookDeliveries: 'developer_webhook_deliveries',
  webhookFailures: 'developer_webhook_failures',
} as const;

export interface UsageBucket {
  periodId: string;
  meterKey: string;
  quantity: number;
}

export interface UsageQuery {
  applicationId?: string;
  from?: Date;
  to?: Date;
  granularity: 'minute' | 'hour' | 'day';
}

export interface UsageRollup {
  totalRequests: number;
  totalRateLimited: number;
  totalWebhookDeliveries: number;
  totalWebhookFailures: number;
  byEndpoint: { endpoint: string; requests: number; errors4xx: number; errors5xx: number }[];
  byApiVersion: { version: string; requests: number }[];
  /** The authoritative period these numbers come from. */
  periodId: string;
  sources: { meterKey: string; count: number }[];
}

@Injectable()
export class DeveloperUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Deterministic period id at the requested granularity. */
  periodFor(date: Date, granularity: UsageQuery['granularity']): string {
    const iso = date.toISOString();
    if (granularity === 'day') return iso.slice(0, 10);
    if (granularity === 'hour') return iso.slice(0, 13);
    return iso.slice(0, 16);
  }

  /**
   * Aggregates authoritative usage events for one tenant/application. All
   * numbers are derived from UsageEvent rows — client-reported claims are
   * structurally unusable here.
   */
  async rollup(tenantId: string, query: UsageQuery): Promise<UsageRollup> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const meterKeys = Object.values(DEVELOPER_METER_KEYS);
    const events = await this.prisma.usageEvent.findMany({
      where: {
        tenantId,
        meterKey: { in: meterKeys },
        createdAt: { gte: from, lte: to },
        ...(query.applicationId
          ? { safeMetadata: { path: ['applicationId'], equals: query.applicationId } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 50_000,
    });

    const periodId = this.periodFor(to, query.granularity);
    const rollup: UsageRollup = {
      totalRequests: 0,
      totalRateLimited: 0,
      totalWebhookDeliveries: 0,
      totalWebhookFailures: 0,
      byEndpoint: [],
      byApiVersion: [],
      periodId,
      sources: [],
    };

    const endpointMap = new Map<string, { requests: number; errors4xx: number; errors5xx: number }>();
    const versionMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();

    for (const event of events) {
      sourceMap.set(event.meterKey, (sourceMap.get(event.meterKey) ?? 0) + event.quantity);
      const metadata = (event.safeMetadata ?? {}) as Record<string, unknown>;
      const endpoint = typeof metadata.endpoint === 'string' ? metadata.endpoint : 'unknown';
      const version = typeof metadata.apiVersion === 'string' ? metadata.apiVersion : 'unknown';

      switch (event.meterKey) {
        case DEVELOPER_METER_KEYS.apiRequests: {
          rollup.totalRequests += event.quantity;
          const bucket = endpointMap.get(endpoint) ?? { requests: 0, errors4xx: 0, errors5xx: 0 };
          bucket.requests += event.quantity;
          const outcome = typeof metadata.outcome === 'string' ? metadata.outcome : 'ok';
          if (outcome === '4xx') bucket.errors4xx += event.quantity;
          if (outcome === '5xx') bucket.errors5xx += event.quantity;
          endpointMap.set(endpoint, bucket);
          versionMap.set(version, (versionMap.get(version) ?? 0) + event.quantity);
          break;
        }
        case DEVELOPER_METER_KEYS.rateLimited:
          rollup.totalRateLimited += event.quantity;
          break;
        case DEVELOPER_METER_KEYS.webhookDeliveries:
          rollup.totalWebhookDeliveries += event.quantity;
          break;
        case DEVELOPER_METER_KEYS.webhookFailures:
          rollup.totalWebhookFailures += event.quantity;
          break;
      }
    }

    rollup.byEndpoint = [...endpointMap.entries()]
      .map(([endpoint, counts]) => ({ endpoint, ...counts }))
      .sort((a, b) => b.requests - a.requests);
    rollup.byApiVersion = [...versionMap.entries()]
      .map(([version, requests]) => ({ version, requests }))
      .sort((a, b) => b.requests - a.requests);
    rollup.sources = [...sourceMap.entries()]
      .map(([meterKey, count]) => ({ meterKey, count }))
      .sort((a, b) => a.meterKey.localeCompare(b.meterKey));
    return rollup;
  }

  /** Portal view for one application; 404 instead of another tenant's data. */
  async applicationRollup(tenantId: string, applicationId: string, query: UsageQuery) {
    const application = await this.prisma.developerApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    return this.rollup(tenantId, { ...query, applicationId });
  }
}

import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UsageAlertConfig, UsageAlertEvent, AlertThresholdType, AlertSeverity, AlertState } from './usage-alert.types';
import { MeterKey } from './usage-metering.types';
import { BillingEventService } from '../notifications/billing-event.service';
import { randomUUID } from 'crypto';

/**
 * Generates threshold alerts when usage approaches/exceeds limits,
 * with deduplication and cooldown handling. Does NOT reject operations - alerting layer only.
 */
@Injectable()
export class UsageAlertService {
  private readonly logger = new Logger(UsageAlertService.name);

  // Default thresholds for informational alerting (not commercial policy)
  private readonly DEFAULT_THRESHOLDS = [
    { percentage: 50, severity: AlertSeverity.INFO },
    { percentage: 75, severity: AlertSeverity.WARNING },
    { percentage: 90, severity: AlertSeverity.WARNING },
    { percentage: 100, severity: AlertSeverity.CRITICAL },
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async evaluateAndAlert(params: {
    tenantId: string;
    meterKey: MeterKey;
    limitKey: string;
    currentValue: number;
    maximumValue: number | null;
    utilizationPercent: number | null;
    periodId: string;
  }): Promise<UsageAlertEvent[]> {
    if (params.maximumValue === null) {
      // Unlimited - no alerts needed
      return [];
    }

    const configs = await this.getAlertConfigs(params.tenantId, params.meterKey, params.limitKey);

    const triggeredEvents: UsageAlertEvent[] = [];

    for (const config of configs) {
      if (!config.enabled) continue;

      // Cooldown check
      if (config.lastTriggeredAt) {
        const lastTriggered = new Date(config.lastTriggeredAt);
        const cooldownMs = config.cooldownMinutes * 60 * 1000;
        const nextAllowed = new Date(lastTriggered.getTime() + cooldownMs);
        if (new Date() < nextAllowed) {
          this.logger.log(`Alert cooldown active for config ${config.id} tenant=${params.tenantId} meter=${params.meterKey} until ${nextAllowed.toISOString()}`);
          continue;
        }
      }

      let shouldTrigger = false;

      if (config.thresholdType === AlertThresholdType.PERCENTAGE) {
        if (params.utilizationPercent !== null && params.utilizationPercent >= config.thresholdValue) {
          shouldTrigger = true;
        }
      } else if (config.thresholdType === AlertThresholdType.ABSOLUTE) {
        if (params.currentValue >= config.thresholdValue) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        const idempotencyKey = `alert_${params.tenantId}_${config.id}_${params.periodId}_${config.thresholdValue}`;

        // Deduplication check
        const existing = await this.findEventByIdempotencyKey(idempotencyKey);
        if (existing) {
          this.logger.log(`Duplicate alert suppressed by idempotencyKey: ${idempotencyKey}`);
          continue;
        }

        const event = await this.createAlertEvent({
          tenantId: params.tenantId,
          configId: config.id,
          meterKey: params.meterKey,
          limitKey: params.limitKey,
          thresholdType: config.thresholdType,
          thresholdValue: config.thresholdValue,
          currentValue: params.currentValue,
          maximumValue: params.maximumValue,
          utilizationPercent: params.utilizationPercent,
          severity: config.severity,
          periodId: params.periodId,
          idempotencyKey,
          safeMetadata: {
            meterKey: params.meterKey,
            limitKey: params.limitKey,
            currentValue: params.currentValue,
            maximumValue: params.maximumValue,
          },
        });

        triggeredEvents.push(event);

        // Update last triggered
        await this.updateConfigLastTriggered(config.id);

        // Trigger billing notification for usage threshold
        if (this.billingEventService) {
          this.billingEventService.onUsageThresholdReached({
            tenantId: params.tenantId,
            meterKey: params.meterKey,
            limitKey: params.limitKey,
            usagePercentage: params.utilizationPercent || config.thresholdValue,
            currentUsage: params.currentValue,
            maxLimit: params.maximumValue,
            supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
            appName: process.env.APP_NAME || 'WLCT',
          }).catch((e) => this.logger.warn(`Failed to trigger usage threshold notification: ${e.message}`));
        }

        this.logger.log(
          `Usage alert triggered tenant=${params.tenantId} meter=${params.meterKey} threshold=${config.thresholdValue}${config.thresholdType === AlertThresholdType.PERCENTAGE ? '%' : ''} current=${params.currentValue} max=${params.maximumValue} severity=${config.severity}`,
        );
      }
    }

    return triggeredEvents;
  }

  async getAlertConfigs(tenantId: string, meterKey?: MeterKey, limitKey?: string): Promise<UsageAlertConfig[]> {
    try {
      const where: any = { tenantId };
      if (meterKey) where.meterKey = meterKey;
      if (limitKey) where.limitKey = limitKey;

      const results = await (this.prisma as any).usageAlertConfig?.findMany({
        where,
        orderBy: { thresholdValue: 'asc' },
      });

      if (results && results.length > 0) {
        return results.map((r: any) => this.mapConfigToDomain(r));
      }

      // Fallback: return default thresholds as configs if none configured
      if (meterKey && limitKey) {
        return this.DEFAULT_THRESHOLDS.map((t) => ({
          id: `default_${tenantId}_${meterKey}_${t.percentage}`,
          tenantId,
          meterKey: meterKey!,
          limitKey: limitKey!,
          thresholdType: AlertThresholdType.PERCENTAGE,
          thresholdValue: t.percentage,
          severity: t.severity,
          enabled: true,
          cooldownMinutes: 60,
          lastTriggeredAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: { default: true },
        }));
      }

      return [];
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        // Return defaults if table missing
        if (meterKey && limitKey) {
          return this.DEFAULT_THRESHOLDS.map((t) => ({
            id: `default_${tenantId}_${meterKey}_${t.percentage}`,
            tenantId,
            meterKey: meterKey!,
            limitKey: limitKey!,
            thresholdType: AlertThresholdType.PERCENTAGE,
            thresholdValue: t.percentage,
            severity: t.severity,
            enabled: true,
            cooldownMinutes: 60,
            lastTriggeredAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: { default: true },
          }));
        }
        return [];
      }
      throw error;
    }
  }

  async createAlertConfig(params: {
    tenantId: string;
    meterKey: MeterKey;
    limitKey: string;
    thresholdType: AlertThresholdType;
    thresholdValue: number;
    severity: AlertSeverity;
    enabled?: boolean;
    cooldownMinutes?: number;
  }): Promise<UsageAlertConfig> {
    // Validate threshold range
    if (params.thresholdType === AlertThresholdType.PERCENTAGE) {
      if (params.thresholdValue < 1 || params.thresholdValue > 200) {
        throw new Error('Percentage threshold must be 1-200');
      }
    } else {
      if (params.thresholdValue < 1) {
        throw new Error('Absolute threshold must be >=1');
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const config: UsageAlertConfig = {
      id,
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      limitKey: params.limitKey,
      thresholdType: params.thresholdType,
      thresholdValue: params.thresholdValue,
      severity: params.severity,
      enabled: params.enabled ?? true,
      cooldownMinutes: params.cooldownMinutes ?? 60,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
      metadata: null,
    };

    try {
      const created = await (this.prisma as any).usageAlertConfig?.create({
        data: {
          id: config.id,
          tenantId: config.tenantId,
          meterKey: config.meterKey,
          limitKey: config.limitKey,
          thresholdType: config.thresholdType,
          thresholdValue: config.thresholdValue,
          severity: config.severity,
          enabled: config.enabled,
          cooldownMinutes: config.cooldownMinutes,
          lastTriggeredAt: null,
          createdAt: new Date(config.createdAt),
          updatedAt: new Date(config.updatedAt),
        },
      });

      if (created) return this.mapConfigToDomain(created);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`usageAlertConfig table not found, fallback: ${error.message}`);
        return config;
      }
      throw error;
    }

    return config;
  }

  async updateAlertConfig(
    id: string,
    tenantId: string,
    updates: { enabled?: boolean; thresholdValue?: number; severity?: AlertSeverity; cooldownMinutes?: number },
  ): Promise<UsageAlertConfig | null> {
    try {
      const data: any = { updatedAt: new Date() };
      if (updates.enabled !== undefined) data.enabled = updates.enabled;
      if (updates.thresholdValue !== undefined) data.thresholdValue = updates.thresholdValue;
      if (updates.severity !== undefined) data.severity = updates.severity;
      if (updates.cooldownMinutes !== undefined) data.cooldownMinutes = updates.cooldownMinutes;

      const updated = await (this.prisma as any).usageAlertConfig?.update({
        where: { id, tenantId },
        data,
      });

      if (!updated) return null;
      return this.mapConfigToDomain(updated);
    } catch {
      return null;
    }
  }

  async listAlertEvents(
    tenantId: string,
    filter?: { meterKey?: MeterKey; severity?: AlertSeverity; state?: AlertState; fromDate?: Date; toDate?: Date; limit?: number; offset?: number },
  ): Promise<UsageAlertEvent[]> {
    try {
      const where: any = { tenantId };
      if (filter?.meterKey) where.meterKey = filter.meterKey;
      if (filter?.severity) where.severity = filter.severity;
      if (filter?.state) where.state = filter.state;
      if (filter?.fromDate || filter?.toDate) {
        where.triggeredAt = {};
        if (filter.fromDate) where.triggeredAt.gte = filter.fromDate;
        if (filter.toDate) where.triggeredAt.lte = filter.toDate;
      }

      const results = await (this.prisma as any).usageAlertEvent?.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        take: filter?.limit || 100,
        skip: filter?.offset || 0,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapEventToDomain(r));
    } catch {
      return [];
    }
  }

  private async createAlertEvent(params: {
    tenantId: string;
    configId: string;
    meterKey: MeterKey;
    limitKey: string;
    thresholdType: AlertThresholdType;
    thresholdValue: number;
    currentValue: number;
    maximumValue: number | null;
    utilizationPercent: number | null;
    severity: AlertSeverity;
    periodId: string;
    idempotencyKey: string;
    safeMetadata?: Record<string, unknown> | null;
  }): Promise<UsageAlertEvent> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const event: UsageAlertEvent = {
      id,
      tenantId: params.tenantId,
      configId: params.configId,
      meterKey: params.meterKey,
      limitKey: params.limitKey,
      thresholdType: params.thresholdType,
      thresholdValue: params.thresholdValue,
      currentValue: params.currentValue,
      maximumValue: params.maximumValue,
      utilizationPercent: params.utilizationPercent,
      severity: params.severity,
      state: AlertState.TRIGGERED,
      periodId: params.periodId,
      triggeredAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      deliveryState: 'PENDING',
      idempotencyKey: params.idempotencyKey,
      safeMetadata: params.safeMetadata || null,
      createdAt: now,
    };

    try {
      const created = await (this.prisma as any).usageAlertEvent?.create({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          configId: event.configId,
          meterKey: event.meterKey,
          limitKey: event.limitKey,
          thresholdType: event.thresholdType,
          thresholdValue: event.thresholdValue,
          currentValue: event.currentValue,
          maximumValue: event.maximumValue,
          utilizationPercent: event.utilizationPercent,
          severity: event.severity,
          state: event.state,
          periodId: event.periodId,
          triggeredAt: new Date(event.triggeredAt),
          deliveryState: event.deliveryState,
          idempotencyKey: event.idempotencyKey,
          safeMetadata: event.safeMetadata,
          createdAt: new Date(event.createdAt),
        },
      });

      if (created) return this.mapEventToDomain(created);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`usageAlertEvent table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: params.tenantId,
              action: 'USAGE_ALERT_TRIGGERED',
              resource: 'UsageAlert',
              resourceId: id,
              metadata: { ...event, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return event;
      }
      if (error.code === 'P2002') {
        const existing = await this.findEventByIdempotencyKey(params.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }

    return event;
  }

  private async findEventByIdempotencyKey(idempotencyKey: string): Promise<UsageAlertEvent | null> {
    try {
      const result = await (this.prisma as any).usageAlertEvent?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapEventToDomain(result);
    } catch {
      return null;
    }
  }

  private async updateConfigLastTriggered(id: string): Promise<void> {
    try {
      await (this.prisma as any).usageAlertConfig?.update({
        where: { id },
        data: { lastTriggeredAt: new Date(), updatedAt: new Date() },
      });
    } catch {}
  }

  private mapConfigToDomain(raw: any): UsageAlertConfig {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      meterKey: raw.meterKey as MeterKey,
      limitKey: raw.limitKey,
      thresholdType: raw.thresholdType as AlertThresholdType,
      thresholdValue: raw.thresholdValue,
      severity: raw.severity as AlertSeverity,
      enabled: raw.enabled,
      cooldownMinutes: raw.cooldownMinutes,
      lastTriggeredAt: raw.lastTriggeredAt ? new Date(raw.lastTriggeredAt).toISOString() : null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
      metadata: raw.metadata || null,
    };
  }

  private mapEventToDomain(raw: any): UsageAlertEvent {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      configId: raw.configId,
      meterKey: raw.meterKey as MeterKey,
      limitKey: raw.limitKey,
      thresholdType: raw.thresholdType as AlertThresholdType,
      thresholdValue: raw.thresholdValue,
      currentValue: raw.currentValue,
      maximumValue: raw.maximumValue,
      utilizationPercent: raw.utilizationPercent,
      severity: raw.severity as AlertSeverity,
      state: raw.state as AlertState,
      periodId: raw.periodId,
      triggeredAt: raw.triggeredAt ? new Date(raw.triggeredAt).toISOString() : new Date().toISOString(),
      acknowledgedAt: raw.acknowledgedAt ? new Date(raw.acknowledgedAt).toISOString() : null,
      resolvedAt: raw.resolvedAt ? new Date(raw.resolvedAt).toISOString() : null,
      deliveryState: raw.deliveryState,
      idempotencyKey: raw.idempotencyKey,
      safeMetadata: raw.safeMetadata || null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingNotificationEventKey, NotificationChannel, MANDATORY_BILLING_EVENTS } from './billing-notification.types';
import { randomUUID } from 'crypto';

/**
 * Tenant/user notification preferences, channel preferences, opt-in/out rules,
 * mandatory vs optional notification policy.
 * Mandatory billing notifications cannot be disabled.
 */

export interface NotificationPreference {
  id: string;
  tenantId: string;
  userId?: string;
  eventKey?: BillingNotificationEventKey;
  channel: NotificationChannel;
  enabled: boolean;
  category: string;
  isMandatory: boolean;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPreferences(tenantId: string, userId?: string): Promise<NotificationPreference[]> {
    try {
      const where: any = { tenantId };
      if (userId) where.userId = userId;

      const results = await (this.prisma as any).billingNotificationPreference?.findMany({
        where,
        orderBy: { eventKey: 'asc' },
      });

      if (results && results.length > 0) {
        return results.map((r: any) => this.mapToDomain(r));
      }

      // Return defaults if none configured
      return this.getDefaultPreferences(tenantId, userId);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return this.getDefaultPreferences(tenantId, userId);
      }
      throw error;
    }
  }

  async getChannelPreferences(tenantId: string, userId: string, category: string): Promise<{ channel: NotificationChannel; enabled: boolean }[]> {
    // Reuse existing notification preferences from main notifications module if available
    try {
      const existing = await (this.prisma as any).notificationPreference?.findMany({
        where: { userId, category },
      });

      if (existing && existing.length > 0) {
        return existing.map((p: any) => ({
          channel: p.channel as NotificationChannel,
          enabled: p.enabled,
        }));
      }
    } catch {}

    // Fallback to billing preferences
    const billingPrefs = await this.getPreferences(tenantId, userId);
    const grouped = new Map<NotificationChannel, boolean>();

    for (const pref of billingPrefs) {
      if (pref.category === category || !category) {
        grouped.set(pref.channel, pref.enabled);
      }
    }

    if (grouped.size === 0) {
      // Default: all channels enabled
      return [
        { channel: NotificationChannel.EMAIL, enabled: true },
        { channel: NotificationChannel.IN_APP, enabled: true },
        { channel: NotificationChannel.PUSH, enabled: true },
        { channel: NotificationChannel.WEBHOOK, enabled: false },
      ];
    }

    return Array.from(grouped.entries()).map(([channel, enabled]) => ({ channel, enabled }));
  }

  async isChannelEnabled(tenantId: string, userId: string | undefined, eventKey: BillingNotificationEventKey, channel: NotificationChannel): Promise<{ enabled: boolean; isMandatory: boolean; reason?: string }> {
    const isMandatory = MANDATORY_BILLING_EVENTS.has(eventKey);

    // Mandatory billing notifications cannot be disabled
    if (isMandatory && (channel === NotificationChannel.EMAIL || channel === NotificationChannel.IN_APP)) {
      return { enabled: true, isMandatory: true, reason: 'Mandatory billing notification - cannot be disabled' };
    }

    try {
      const pref = await (this.prisma as any).billingNotificationPreference?.findFirst({
        where: {
          tenantId,
          ...(userId ? { userId } : {}),
          eventKey,
          channel,
        },
      });

      if (pref) {
        // Even if user disabled, mandatory events remain enabled
        if (isMandatory && !pref.enabled && (channel === NotificationChannel.EMAIL || channel === NotificationChannel.IN_APP)) {
          return { enabled: true, isMandatory: true, reason: 'Mandatory billing notification overrides user preference' };
        }
        return { enabled: pref.enabled, isMandatory, reason: pref.enabled ? undefined : 'User disabled this channel for this event' };
      }

      // No specific preference - check category preference
      const category = this.getCategoryForEvent(eventKey);
      const categoryPrefs = await this.getChannelPreferences(tenantId, userId || 'unknown', category);
      const channelPref = categoryPrefs.find((p) => p.channel === channel);
      if (channelPref) {
        if (isMandatory && !channelPref.enabled && (channel === NotificationChannel.EMAIL || channel === NotificationChannel.IN_APP)) {
          return { enabled: true, isMandatory: true, reason: 'Mandatory billing notification overrides category preference' };
        }
        return { enabled: channelPref.enabled, isMandatory };
      }

      // Default enabled for all except webhook
      const defaultEnabled = channel !== NotificationChannel.WEBHOOK;
      return { enabled: defaultEnabled, isMandatory };
    } catch {
      // On error, default to enabled for mandatory, disabled for optional webhook
      const defaultEnabled = isMandatory || channel !== NotificationChannel.WEBHOOK;
      return { enabled: defaultEnabled, isMandatory };
    }
  }

  async updatePreference(params: {
    tenantId: string;
    userId?: string;
    eventKey?: BillingNotificationEventKey;
    channel: NotificationChannel;
    enabled: boolean;
    category?: string;
    locale?: string;
  }): Promise<NotificationPreference> {
    // Prevent disabling mandatory billing notifications for EMAIL and IN_APP
    if (params.eventKey && MANDATORY_BILLING_EVENTS.has(params.eventKey) && !params.enabled) {
      if (params.channel === NotificationChannel.EMAIL || params.channel === NotificationChannel.IN_APP) {
        throw new Error(`Cannot disable mandatory billing notification ${params.eventKey} for channel ${params.channel}`);
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const isMandatory = params.eventKey ? MANDATORY_BILLING_EVENTS.has(params.eventKey) : false;
    const category = params.category || (params.eventKey ? this.getCategoryForEvent(params.eventKey) : 'billing');

    const preference: NotificationPreference = {
      id,
      tenantId: params.tenantId,
      userId: params.userId,
      eventKey: params.eventKey,
      channel: params.channel,
      enabled: params.enabled,
      category,
      isMandatory,
      locale: params.locale || 'en',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await (this.prisma as any).billingNotificationPreference?.upsert({
        where: {
          tenantId_userId_eventKey_channel: {
            tenantId: params.tenantId,
            userId: params.userId || '',
            eventKey: params.eventKey || '',
            channel: params.channel,
          },
        },
        update: {
          enabled: params.enabled,
          updatedAt: new Date(),
          locale: params.locale || 'en',
        },
        create: {
          id: preference.id,
          tenantId: preference.tenantId,
          userId: preference.userId || null,
          eventKey: preference.eventKey || null,
          channel: preference.channel,
          enabled: preference.enabled,
          category: preference.category,
          isMandatory: preference.isMandatory,
          locale: preference.locale,
          createdAt: new Date(preference.createdAt),
          updatedAt: new Date(preference.updatedAt),
        },
      });

      if (result) return this.mapToDomain(result);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`billingNotificationPreference table not found, fallback: ${error.message}`);
        return preference;
      }
      if (error.code === 'P2002') {
        // Try to find existing
        try {
          const existing = await (this.prisma as any).billingNotificationPreference?.findFirst({
            where: {
              tenantId: params.tenantId,
              userId: params.userId || null,
              eventKey: params.eventKey || null,
              channel: params.channel,
            },
          });
          if (existing) {
            const updated = await (this.prisma as any).billingNotificationPreference?.update({
              where: { id: existing.id },
              data: { enabled: params.enabled, updatedAt: new Date() },
            });
            if (updated) return this.mapToDomain(updated);
          }
        } catch {}
      }
      throw error;
    }

    return preference;
  }

  async updatePreferencesBulk(
    tenantId: string,
    userId: string | undefined,
    preferences: { eventKey?: BillingNotificationEventKey; channel: NotificationChannel; enabled: boolean; category?: string }[],
  ): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];
    for (const pref of preferences) {
      try {
        const updated = await this.updatePreference({
          tenantId,
          userId,
          eventKey: pref.eventKey,
          channel: pref.channel,
          enabled: pref.enabled,
          category: pref.category,
        });
        results.push(updated);
      } catch (e) {
        this.logger.warn(`Failed to update preference ${pref.eventKey} ${pref.channel}: ${(e as Error).message}`);
        // For mandatory, we throw, but for bulk we skip and continue
        if ((e as Error).message.includes('Cannot disable mandatory')) {
          throw e;
        }
      }
    }
    return results;
  }

  private getDefaultPreferences(tenantId: string, userId?: string): NotificationPreference[] {
    const now = new Date().toISOString();
    const preferences: NotificationPreference[] = [];

    for (const eventKey of Object.values(BillingNotificationEventKey)) {
      const isMandatory = MANDATORY_BILLING_EVENTS.has(eventKey as BillingNotificationEventKey);
      const category = this.getCategoryForEvent(eventKey as BillingNotificationEventKey);

      for (const channel of [NotificationChannel.EMAIL, NotificationChannel.IN_APP, NotificationChannel.PUSH]) {
        preferences.push({
          id: `default_${tenantId}_${userId || 'tenant'}_${eventKey}_${channel}`,
          tenantId,
          userId,
          eventKey: eventKey as BillingNotificationEventKey,
          channel,
          enabled: true,
          category,
          isMandatory,
          locale: 'en',
          createdAt: now,
          updatedAt: now,
        });
      }

      // Webhook disabled by default
      preferences.push({
        id: `default_${tenantId}_${userId || 'tenant'}_${eventKey}_WEBHOOK`,
        tenantId,
        userId,
        eventKey: eventKey as BillingNotificationEventKey,
        channel: NotificationChannel.WEBHOOK,
        enabled: false,
        category,
        isMandatory: false,
        locale: 'en',
        createdAt: now,
        updatedAt: now,
      });
    }

    return preferences;
  }

  private getCategoryForEvent(eventKey: BillingNotificationEventKey): string {
    if (eventKey.startsWith('PAYMENT_') || eventKey.startsWith('REFUND_')) return 'billing';
    if (eventKey.startsWith('INVOICE_')) return 'billing';
    if (eventKey.startsWith('SUBSCRIPTION_') || eventKey.startsWith('TRIAL_')) return 'subscription';
    if (eventKey.startsWith('DUNNING_')) return 'dunning';
    if (eventKey.startsWith('USAGE_')) return 'usage';
    if (eventKey.startsWith('FEE_') || eventKey.startsWith('PAYOUT_')) return 'fee';
    if (eventKey.startsWith('CUSTOM_DOMAIN_') || eventKey.startsWith('WHITE_LABEL_') || eventKey.startsWith('SAAS_')) return 'saas_admin';
    return 'billing';
  }

  private mapToDomain(raw: any): NotificationPreference {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      userId: raw.userId || undefined,
      eventKey: raw.eventKey as BillingNotificationEventKey || undefined,
      channel: raw.channel as NotificationChannel,
      enabled: raw.enabled,
      category: raw.category,
      isMandatory: raw.isMandatory || false,
      locale: raw.locale || 'en',
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}

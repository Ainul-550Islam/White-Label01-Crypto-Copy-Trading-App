import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationJobRepository } from './notification-job.repository';
import { NotificationPreferenceService } from './notification-preference.service';
import { BillingWebhookNotificationService } from './billing-webhook-notification.service';
import { NotificationWorkerService } from './notification-worker.service';
import { NotificationReconciliationService } from './notification-reconciliation.service';
import { InAppNotificationService } from './in-app-notification.service';
import { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto, RotateWebhookSecretDto } from './dto/webhook-subscription.dto';
import { NotificationHistoryQueryDto, NotificationInboxQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferenceDto, BulkUpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { DeliveryStatus, NotificationChannel, BillingNotificationEventKey } from './billing-notification.types';

/**
 * Billing Notifications Controller.
 * Tenant-isolated endpoints for history, inbox, preferences, webhooks, worker, reconciliation.
 * No secrets returned plaintext, no cross-tenant access.
 */

@Controller('billing/notifications')
export class BillingNotificationController {
  constructor(
    private readonly jobRepository: NotificationJobRepository,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly webhookService: BillingWebhookNotificationService,
    private readonly workerService: NotificationWorkerService,
    private readonly reconciliationService: NotificationReconciliationService,
    private readonly inAppService: InAppNotificationService,
  ) {}

  // History - tenant isolated
  @Get('history')
  async getHistory(@Request() req: any, @Query() query: NotificationHistoryQueryDto) {
    const tenantId = req.user?.tenantId || req.tenantId || (query as any).tenantId || 'unknown';
    const filter: any = {};
    if (query.eventKey) filter.eventKey = query.eventKey;
    if (query.channel) filter.channel = query.channel;
    if (query.status) filter.status = query.status;
    if (query.userId) filter.userId = query.userId;
    if (query.fromDate) filter.fromDate = new Date(query.fromDate);
    if (query.toDate) filter.toDate = new Date(query.toDate);
    filter.limit = query.limit || 20;
    filter.offset = ((query.page || 1) - 1) * filter.limit;

    const jobs = await this.jobRepository.listByTenant(tenantId, filter);
    return {
      tenantId,
      data: jobs,
      page: query.page || 1,
      limit: filter.limit,
      total: jobs.length,
    };
  }

  @Get('history/:id')
  async getHistoryById(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const job = await this.jobRepository.findById(id, tenantId);
    if (!job) {
      return { error: 'Notification not found', tenantId };
    }
    return job;
  }

  // Inbox - user scoped in-app notifications
  @Get('inbox')
  async getInbox(@Request() req: any, @Query() query: NotificationInboxQueryDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId || 'unknown';
    const notifications = await this.inAppService.listNotifications(tenantId, userId, {
      unreadOnly: query.unreadOnly,
      eventKey: query.eventKey,
      channel: query.channel,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      limit: query.limit,
      offset: ((query.page || 1) - 1) * (query.limit || 20),
    });
    return {
      tenantId,
      userId,
      data: notifications,
      page: query.page || 1,
      limit: query.limit || 20,
    };
  }

  @Get('inbox/unread-count')
  async getUnreadCount(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId || 'unknown';
    const count = await this.inAppService.getUnreadCount(tenantId, userId);
    return { tenantId, userId, unreadCount: count };
  }

  @Put('inbox/:id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId || 'unknown';
    const result = await this.inAppService.markRead(tenantId, userId, id);
    return result;
  }

  @Put('inbox/read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId || 'unknown';
    const result = await this.inAppService.markAllRead(tenantId, userId);
    return result;
  }

  // Preferences
  @Get('preferences')
  async getPreferences(@Request() req: any, @Query('userId') userId?: string) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const effectiveUserId = userId || req.user?.id;
    const prefs = await this.preferenceService.getPreferences(tenantId, effectiveUserId);
    return { tenantId, userId: effectiveUserId, data: prefs };
  }

  @Put('preferences')
  async updatePreference(@Request() req: any, @Body() dto: UpdateNotificationPreferenceDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId;
    const updated = await this.preferenceService.updatePreference({
      tenantId,
      userId,
      eventKey: dto.eventKey,
      channel: dto.channel,
      enabled: dto.enabled,
      category: dto.category,
      locale: dto.locale,
    });
    return updated;
  }

  @Put('preferences/bulk')
  async bulkUpdatePreferences(@Request() req: any, @Body() dto: BulkUpdateNotificationPreferencesDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const userId = req.user?.id || req.userId;
    const updated = await this.preferenceService.updatePreferencesBulk(tenantId, userId, dto.preferences);
    return { tenantId, userId, data: updated };
  }

  // Webhook subscriptions - tenant isolated, HTTPS validation, no secret plaintext return
  @Get('webhooks')
  async listWebhooks(@Request() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const subs = await this.webhookService.listSubscriptions(tenantId);
    // Never return secretHash, only masked
    return subs.map((s) => ({
      id: s.id,
      tenantId: s.tenantId,
      endpointUrl: s.endpointUrl,
      eventTypes: s.eventTypes,
      enabled: s.enabled,
      secretMasked: s.secretMasked,
      lastDeliveryAt: s.lastDeliveryAt,
      lastDeliveryStatus: s.lastDeliveryStatus,
      failureCount: s.failureCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  @Post('webhooks')
  async createWebhook(@Request() req: any, @Body() dto: CreateWebhookSubscriptionDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const sub = await this.webhookService.createSubscription({
      tenantId,
      endpointUrl: dto.endpointUrl,
      eventTypes: dto.eventTypes,
      secret: dto.secret,
      enabled: dto.enabled,
    });
    // Return masked only
    return {
      id: sub.id,
      tenantId: sub.tenantId,
      endpointUrl: sub.endpointUrl,
      eventTypes: sub.eventTypes,
      enabled: sub.enabled,
      secretMasked: sub.secretMasked,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    };
  }

  @Put('webhooks/:id')
  async updateWebhook(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateWebhookSubscriptionDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const updated = await this.webhookService.updateSubscription(id, tenantId, {
      endpointUrl: dto.endpointUrl,
      eventTypes: dto.eventTypes,
      enabled: dto.enabled,
    });
    if (!updated) return { error: 'Webhook not found' };
    return {
      id: updated.id,
      endpointUrl: updated.endpointUrl,
      eventTypes: updated.eventTypes,
      enabled: updated.enabled,
      secretMasked: updated.secretMasked,
      updatedAt: updated.updatedAt,
    };
  }

  @Post('webhooks/:id/rotate-secret')
  async rotateSecret(@Request() req: any, @Param('id') id: string, @Body() dto: RotateWebhookSecretDto) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const updated = await this.webhookService.rotateSecret(id, tenantId, dto.newSecret);
    if (!updated) return { error: 'Webhook not found' };
    return {
      id: updated.id,
      secretMasked: updated.secretMasked,
      updatedAt: updated.updatedAt,
      message: 'Secret rotated successfully. New secret masked.',
    };
  }

  @Delete('webhooks/:id')
  async deleteWebhook(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId || req.tenantId || 'unknown';
    const deleted = await this.webhookService.deleteSubscription(id, tenantId);
    return { deleted, id, tenantId };
  }

  // Worker - admin only
  @Post('worker/process')
  @HttpCode(HttpStatus.OK)
  async processWorker(@Query('batchSize') batchSize?: number) {
    const result = await this.workerService.processPendingJobs(batchSize || 20);
    return result;
  }

  @Get('worker/stuck')
  async detectStuck(@Query('thresholdHours') thresholdHours?: number) {
    const stuck = await this.workerService.detectStuckJobs(thresholdHours ? Number(thresholdHours) : 2);
    return { stuck, count: stuck.length };
  }

  // Reconciliation - admin only
  @Get('reconciliation/:tenantId')
  async reconcileTenant(@Param('tenantId') tenantId: string) {
    const result = await this.reconciliationService.reconcileTenant(tenantId);
    return result;
  }

  @Post('reconciliation/all')
  @HttpCode(HttpStatus.OK)
  async reconcileAll(@Query('limit') limit?: number) {
    const result = await this.reconciliationService.reconcileAllTenants(limit || 100);
    return { tenantsWithIssues: result.length, data: result };
  }
}

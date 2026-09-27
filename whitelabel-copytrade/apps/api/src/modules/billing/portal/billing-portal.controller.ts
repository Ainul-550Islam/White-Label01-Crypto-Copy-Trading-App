import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../../common/pipes/parse-uuid.pipe';
import { Permission, type AuthenticatedActor, BillingInterval } from '@wlct/shared-types';
import { BillingPortalService } from './billing-portal.service';
import { BillingInvoiceQueryService } from './billing-invoice-query.service';
import { BillingPaymentHistoryService } from './billing-payment-history.service';
import { BillingUsageSummaryService } from './billing-usage-summary.service';
import { SubscriptionManagementService } from './subscription-management.service';
import { PlanChangeService } from './plan-change.service';
import { CheckoutService } from '../payments/checkout.service';
import { CreateCheckoutSessionRequestDto } from './dto/checkout-session.dto';
import { ChangePlanRequestDto, CancelSubscriptionRequestDto, ResumeSubscriptionRequestDto, ChangeIntervalRequestDto } from './dto/subscription-action.dto';

/**
 * Authenticated tenant billing endpoints.
 * All endpoints tenant-scoped, RBAC protected, safe errors.
 * No endpoint exposes another tenant's data.
 */
@ApiTags('Billing - portal')
@ApiBearerAuth()
@Controller({ path: 'billing/portal', version: '1' })
@ApiStandardResponses()
export class BillingPortalController {
  constructor(
    private readonly portalService: BillingPortalService,
    private readonly invoiceQuery: BillingInvoiceQueryService,
    private readonly paymentHistory: BillingPaymentHistoryService,
    private readonly usageSummary: BillingUsageSummaryService,
    private readonly subscriptionMgmt: SubscriptionManagementService,
    private readonly planChangeService: PlanChangeService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Get('overview')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get billing overview for current tenant' })
  @ApiOkResponse({ description: 'Billing overview' })
  async getOverview(@TenantId() tenantId: string, @CurrentUser() actor: AuthenticatedActor) {
    return this.portalService.getBillingOverview(tenantId, {
      tenantId: actor.tenantId,
      isPlatformUser: actor.isPlatformUser,
      userId: actor.userId,
    });
  }

  @Get('subscription')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get current subscription state' })
  @ApiOkResponse({ description: 'Subscription state' })
  async getSubscription(@TenantId() tenantId: string) {
    return this.subscriptionMgmt.getSubscriptionState(tenantId);
  }

  @Get('plans')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get available plans from canonical catalog' })
  @ApiOkResponse({ description: 'Available plans' })
  async getPlans(@TenantId() tenantId: string, @CurrentUser() actor: AuthenticatedActor) {
    const plans = await this.portalService.getAvailablePlans(tenantId, {
      tenantId: actor.tenantId,
      isPlatformUser: actor.isPlatformUser,
    });
    return { tenantId, plans, fetchedAt: new Date().toISOString() };
  }

  @Get('plans/comparison')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get dynamic plan comparison from canonical catalog' })
  @ApiOkResponse({ description: 'Plan comparison' })
  async getPlanComparison(@TenantId() tenantId: string, @CurrentUser() actor: AuthenticatedActor) {
    return this.portalService.getPlanComparison(tenantId, {
      tenantId: actor.tenantId,
      isPlatformUser: actor.isPlatformUser,
    });
  }

  @Get('usage')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get current usage against canonical limits' })
  @ApiOkResponse({ description: 'Usage summary' })
  async getUsage(@TenantId() tenantId: string) {
    return this.usageSummary.getUsageSummary(tenantId);
  }

  @Get('invoices')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'List tenant invoices' })
  @ApiOkResponse({ description: 'Invoice list' })
  async listInvoices(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const invoices = await this.invoiceQuery.listInvoices(tenantId, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });

    return { tenantId, invoices, total: invoices.length, fetchedAt: new Date().toISOString() };
  }

  @Get('invoices/:id')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get invoice detail' })
  @ApiOkResponse({ description: 'Invoice detail' })
  async getInvoiceDetail(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.invoiceQuery.getInvoiceDetail(tenantId, id);
  }

  @Get('invoices/:id/pdf-metadata')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get invoice PDF metadata' })
  @ApiOkResponse({ description: 'PDF metadata' })
  async getInvoicePdfMetadata(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.invoiceQuery.getInvoicePdfMetadata(tenantId, id);
  }

  @Get('payments')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'List tenant payment history' })
  @ApiOkResponse({ description: 'Payment history' })
  async listPayments(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('limit') limit?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const payments = await this.paymentHistory.listPayments(tenantId, {
      status,
      provider,
      limit: limit ? parseInt(limit, 10) : undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });

    return { tenantId, payments, total: payments.length, fetchedAt: new Date().toISOString() };
  }

  @Get('payments/:id')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get payment detail' })
  @ApiOkResponse({ description: 'Payment detail' })
  async getPaymentDetail(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.paymentHistory.getPaymentDetail(tenantId, id);
  }

  @Get('payments/:id/status')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get verified payment status from backend/provider' })
  @ApiOkResponse({ description: 'Verified payment status' })
  async getPaymentStatus(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.paymentHistory.getPaymentStatus(tenantId, id);
  }

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @ApiOperation({ summary: 'Create checkout session - backend decides price/provider' })
  @ApiOkResponse({ description: 'Checkout session with safe data' })
  async createCheckout(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: CreateCheckoutSessionRequestDto,
  ) {
    // Tenant isolation: effective tenant from auth context
    const effectiveTenantId = tenantId;

    const result = await this.checkoutService.createCheckout({
      tenantId: effectiveTenantId,
      userId: actor.userId,
      planId: dto.planId,
      billingInterval: (dto.billingInterval as any) || BillingInterval.MONTHLY,
      currency: dto.currency || 'USD',
      provider: (dto.provider as any) || undefined,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      idempotencyKey: dto.idempotencyKey || `checkout_${effectiveTenantId}_${dto.planId}_${Date.now()}`,
      seats: dto.seats,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    } as any);

    // Return only safe data - no provider secrets
    return {
      checkoutId: result.checkoutId,
      paymentId: result.paymentId,
      provider: result.provider,
      status: result.status,
      paymentStatus: result.paymentStatus,
      checkoutUrl: result.checkoutUrl,
      invoiceUrl: result.invoiceUrl,
      providerCheckoutId: result.providerCheckoutId,
      providerSessionId: result.providerSessionId,
      amount: result.amount,
      currency: result.currency,
      planId: result.planId,
      planCode: result.planCode,
      planName: result.planName,
      billingInterval: result.billingInterval,
      expiresAt: result.expiresAt,
      createdAt: result.createdAt,
    };
  }

  @Get('checkout/:id/status')
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get checkout status - verified from backend' })
  @ApiOkResponse({ description: 'Checkout status verified' })
  async getCheckoutStatus(@TenantId() tenantId: string, @Param('id', ParseUuidPipe) id: string) {
    const status = await this.checkoutService.getCheckoutStatus(id, tenantId);

    // Also verify via payment history service for double verification
    let verified = false;
    try {
      const paymentStatus = await this.paymentHistory.getPaymentStatus(tenantId, id);
      verified = paymentStatus.verified;
    } catch {
      verified = false;
    }

    return { ...status, verified };
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @ApiOperation({ summary: 'Cancel subscription at period end' })
  @ApiOkResponse({ description: 'Cancellation result' })
  async cancelSubscription(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: CancelSubscriptionRequestDto,
  ) {
    const result = await this.subscriptionMgmt.cancelAtPeriodEnd(tenantId, dto.reason, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      tenantId,
      action: 'CANCEL_AT_PERIOD_END',
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      effectiveAt: result.effectiveAt,
      message: result.message,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('subscription/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @ApiOperation({ summary: 'Resume cancelled-at-period-end subscription' })
  @ApiOkResponse({ description: 'Resume result' })
  async resumeSubscription(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: ResumeSubscriptionRequestDto,
  ) {
    const result = await this.subscriptionMgmt.resumeCancelled(tenantId, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return {
      tenantId,
      action: 'RESUME',
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      effectiveAt: new Date().toISOString(),
      message: result.message,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('subscription/change-plan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @ApiOperation({ summary: 'Change plan - validates via canonical catalog' })
  @ApiOkResponse({ description: 'Plan change result' })
  async changePlan(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: ChangePlanRequestDto,
  ) {
    const result = await this.subscriptionMgmt.changePlan(tenantId, dto.planId, {
      atPeriodEnd: dto.atPeriodEnd,
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
      actor: { tenantId: actor.tenantId, isPlatformUser: actor.isPlatformUser },
    });

    return {
      tenantId,
      action: 'CHANGE_PLAN',
      subscriptionId: (result.subscription?.id || result.requestedPlan?.id || dto.planId) as string,
      status: (result.subscription?.status || 'PENDING_CHECKOUT') as string,
      effectiveAt: (result.effectiveAt || null) as string | null,
      message: (result.message || `Plan change to ${result.requestedPlan?.code || dto.planId}`) as string,
      requiresCheckout: (result.requiresCheckout || false) as boolean,
      priceDelta: (result.priceDelta || null) as string | null,
      updatedAt: new Date().toISOString(),
    };
  }

  @Post('subscription/change-interval')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @ApiOperation({ summary: 'Change billing interval' })
  @ApiOkResponse({ description: 'Interval change result' })
  async changeInterval(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
    @Body() dto: ChangeIntervalRequestDto,
  ) {
    const result = await this.subscriptionMgmt.changeBillingInterval(tenantId, dto.newInterval as BillingInterval, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
      actor: { tenantId: actor.tenantId, isPlatformUser: actor.isPlatformUser },
    });

    return {
      tenantId,
      action: 'CHANGE_INTERVAL',
      subscriptionId: (result.subscription?.id || 'pending') as string,
      status: (result.subscription?.status || 'PENDING') as string,
      effectiveAt: (result.effectiveAt || null) as string | null,
      message: (result.message || `Interval change to ${dto.newInterval}`) as string,
      requiresCheckout: (result.requiresCheckout || false) as boolean,
      priceDelta: (result.priceDelta || null) as string | null,
      updatedAt: new Date().toISOString(),
    };
  }
}

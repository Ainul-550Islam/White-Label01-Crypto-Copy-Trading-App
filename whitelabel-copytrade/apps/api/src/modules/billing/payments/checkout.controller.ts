import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { CheckoutService } from './checkout.service';
import { PaymentProvider } from './payment.types';
import type { CheckoutRequest, CheckoutResponse, CheckoutStatusResponse } from './checkout.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../../common/decorators/request-context.decorator';
import { Audited } from '../../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../../common/pipes/parse-uuid.pipe';
import { Permission, AuditAction, type AuthenticatedActor } from '@wlct/shared-types';
import { BillingInterval } from '@wlct/shared-types';
import { randomUUID } from 'crypto';

/**
 * API endpoints for creating checkout sessions/invoices and retrieving
 * the current checkout/payment state using existing auth, tenant, and RBAC conventions.
 *
 * Follows existing API style:
 *  - Uses tenant context from JWT
 *  - Uses RBAC permissions
 *  - Uses request validation
 *  - Uses existing error handling
 *  - Does not weaken authentication for checkout
 */

@ApiTags('Billing - checkout')
@Controller({ path: 'billing/checkout', version: '1' })
@ApiStandardResponses()
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.SUBSCRIPTION_MANAGE)
  @Audited(AuditAction.PLAN_UPDATED, 'Checkout')
  @ApiOperation({
    summary: 'Create a checkout session/invoice for a plan',
    description:
      'Creates a provider checkout (Stripe session or NowPayments invoice) from the canonical billing plan catalog. ' +
      'Price is resolved from the plan definition, never hardcoded. Idempotency key prevents duplicate provider sessions.',
  })
  @ApiCreatedResponse({ description: 'Checkout created with provider URL' })
  async createCheckout(
    @Body() dto: CheckoutRequest,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<CheckoutResponse> {
    const idempotencyKey = dto.idempotencyKey || `checkout_${tenantId}_${dto.planId}_${Date.now()}_${randomUUID().substring(0, 8)}`;

    return this.checkoutService.createCheckout({
      tenantId,
      userId: actor.userId,
      planId: dto.planId,
      billingInterval: dto.billingInterval || BillingInterval.MONTHLY,
      currency: dto.currency || 'USD',
      provider: dto.provider || PaymentProvider.STRIPE,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      seats: dto.seats,
      idempotencyKey,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
      metadata: dto.metadata,
    });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get checkout/payment status' })
  @ApiOkResponse({ description: 'Current checkout and payment status' })
  async getCheckoutStatus(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<CheckoutStatusResponse> {
    return this.checkoutService.getCheckoutStatus(id, tenantId);
  }

  @Get('payment/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SUBSCRIPTION_READ)
  @ApiOperation({ summary: 'Get payment status by payment ID' })
  @ApiOkResponse({ description: 'Current payment status' })
  async getPaymentStatus(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
  ): Promise<CheckoutStatusResponse> {
    return this.checkoutService.getPaymentStatus(id, tenantId);
  }
}

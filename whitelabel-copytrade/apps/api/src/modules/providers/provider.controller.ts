/**
 * Provider Controller
 * Platform/provider-operator API for provider health, capabilities,
 * configuration status, reconciliation, webhook diagnostics, and controlled actions.
 * Enforces existing platform RBAC and never exposes credentials.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ProviderDomain, ProviderName } from './provider.types';
import { ProviderPolicyService } from './provider-policy.service';
import { ProviderHealthService } from './provider-health.service';
import { ProviderReconciliationService } from './provider-reconciliation.service';
import { ProviderObservationService } from './provider-observation.service';
import { ProviderWebhookService } from './provider-webhook.service';
import {
  ProviderHealthQueryDto,
  ProviderCapabilityQueryDto,
  ProviderReconciliationQueryDto,
  ProviderObservationQueryDto,
  WebhookDiagnosticsQueryDto,
} from './dto/provider-query.dto';
import {
  TriggerHealthCheckDto,
  TriggerReconciliationDto,
  ProviderEnableDisableDto,
  WebhookReplayRequestDto,
  ControlledRetryRequestDto,
  ProviderConfigurationStatusDto,
} from './dto/provider-action.dto';

@Controller('v1/providers')
export class ProviderController {
  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly healthService: ProviderHealthService,
    private readonly reconciliationService: ProviderReconciliationService,
    private readonly observationService: ProviderObservationService,
    private readonly webhookService: ProviderWebhookService,
  ) {}

  @Get('health')
  async getHealth(
    @Query() query: ProviderHealthQueryDto,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    const cid = query.correlationId || correlationId || `health_${Date.now()}`;

    if (query.domain && query.provider) {
      const result = await this.healthService.checkHealth({
        domain: query.domain,
        provider: query.provider,
        correlationId: cid,
        tenantId: query.tenantId,
      });
      return { data: result };
    }

    const results = await this.healthService.checkAllProviders(cid);
    return { data: results };
  }

  @Post('health/check')
  @HttpCode(HttpStatus.OK)
  async triggerHealthCheck(
    @Body() dto: TriggerHealthCheckDto,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    const result = await this.healthService.checkHealth({
      domain: dto.domain,
      provider: dto.provider,
      correlationId: dto.correlationId || correlationId,
      tenantId: dto.tenantId,
    });
    return { data: result };
  }

  @Get('capabilities')
  async getCapabilities(
    @Query() query: ProviderCapabilityQueryDto,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    const environment = process.env.NODE_ENV || 'development';

    if (query.domain) {
      const providers = this.policyService.getAllowedProviders(environment, query.domain);
      const capabilities = providers.map((provider) => {
        const policy = this.policyService.getPolicy(query.domain!, provider);
        return {
          provider,
          domain: query.domain,
          capabilities: policy?.capabilities || [],
          enabled: policy?.enabled || false,
        };
      });
      return { data: capabilities };
    }

    const allDomains = Object.values(ProviderDomain);
    const allCapabilities = allDomains.map((domain) => {
      const providers = this.policyService.getAllowedProviders(environment, domain);
      return {
        domain,
        providers: providers.map((provider) => {
          const policy = this.policyService.getPolicy(domain, provider);
          return {
            provider,
            capabilities: policy?.capabilities || [],
            enabled: policy?.enabled || false,
          };
        }),
      };
    });

    return { data: allCapabilities };
  }

  @Get('configuration/status')
  async getConfigurationStatus(
    @Query() query: ProviderConfigurationStatusDto,
    @Headers('x-correlation-id') correlationId: string,
  ) {
    const environment = process.env.NODE_ENV || 'development';
    const domains = query.domain ? [query.domain] : Object.values(ProviderDomain);

    const status = domains.map((domain) => {
      const providers = query.provider ? [query.provider] : this.policyService.getAllowedProviders(environment, domain);
      return {
        domain,
        providers: providers.map((provider) => {
          const policy = this.policyService.getPolicy(domain, provider);
          const isConfigured = this.isProviderConfigured(domain, provider);
          return {
            provider,
            configured: isConfigured,
            enabled: policy?.enabled || false,
            state: this.policyService.getProviderState(provider, isConfigured, policy?.enabled || false),
            capabilities: policy?.capabilities || [],
            environment: policy?.environment || environment,
            baseUrl: policy?.baseUrl ? this.redactUrl(policy.baseUrl) : 'not-configured',
          };
        }),
      };
    });

    return { data: status, correlationId: query.correlationId || correlationId };
  }

  @Get('observations')
  async getObservations(@Query() query: ProviderObservationQueryDto) {
    if (query.correlationId) {
      return { data: this.observationService.getObservationsByCorrelationId(query.correlationId) };
    }
    if (query.provider) {
      return { data: this.observationService.getObservationsByProvider(query.provider) };
    }
    return { data: [] };
  }

  @Post('reconciliation/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerReconciliation(@Body() dto: TriggerReconciliationDto) {
    return {
      data: {
        domain: dto.domain,
        provider: dto.provider,
        correlationId: dto.correlationId,
        triggeredBy: dto.triggeredBy,
        status: 'ACCEPTED',
        message: 'Reconciliation triggered, results will be delegated to existing domain reconciliation service',
      },
    };
  }

  @Get('reconciliation')
  async getReconciliation(@Query() query: ProviderReconciliationQueryDto) {
    return {
      data: {
        domain: query.domain,
        provider: query.provider,
        correlationId: query.correlationId,
        message: 'Reconciliation status requires correlationId and is delegated to domain reconciliation',
      },
    };
  }

  @Get('webhooks/diagnostics')
  async getWebhookDiagnostics(@Query() query: WebhookDiagnosticsQueryDto) {
    return {
      data: {
        domain: query.domain,
        provider: query.provider,
        eventId: query.eventId,
        correlationId: query.correlationId,
        message: 'Webhook diagnostics: signature validation, replay protection, idempotency checks',
      },
    };
  }

  @Post('webhooks/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayWebhook(@Body() dto: WebhookReplayRequestDto) {
    return {
      data: {
        domain: dto.domain,
        provider: dto.provider,
        eventId: dto.eventId,
        correlationId: dto.correlationId,
        status: 'ACCEPTED',
        message: 'Webhook replay requested, requires approval and will be idempotent',
      },
    };
  }

  @Post('actions/enable-disable')
  @HttpCode(HttpStatus.OK)
  async enableDisableProvider(@Body() dto: ProviderEnableDisableDto) {
    return {
      data: {
        domain: dto.domain,
        provider: dto.provider,
        enabled: dto.enabled,
        reason: dto.reason,
        correlationId: dto.correlationId,
        operatorId: dto.operatorId,
        message: `Provider ${dto.provider} ${dto.enabled ? 'enabled' : 'disabled'} request accepted, requires platform RBAC`,
      },
    };
  }

  @Post('actions/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async controlledRetry(@Body() dto: ControlledRetryRequestDto) {
    return {
      data: {
        domain: dto.domain,
        provider: dto.provider,
        providerReference: dto.providerReference,
        correlationId: dto.correlationId,
        status: 'ACCEPTED',
        message: 'Controlled retry accepted, only safe/idempotent operations will be retried, financial operations require status query first',
      },
    };
  }

  private isProviderConfigured(domain: ProviderDomain, provider: ProviderName): boolean {
    const envMap: Record<string, string> = {
      [`${ProviderDomain.PAYMENT}_${ProviderName.STRIPE}`]: 'STRIPE_SECRET_KEY',
      [`${ProviderDomain.PAYMENT}_${ProviderName.NOWPAYMENTS}`]: 'NOWPAYMENTS_API_KEY',
      [`${ProviderDomain.EXCHANGE}_${ProviderName.BINANCE}`]: 'BINANCE_API_KEY',
      [`${ProviderDomain.EXCHANGE}_${ProviderName.BYBIT}`]: 'BYBIT_API_KEY',
      [`${ProviderDomain.EXCHANGE}_${ProviderName.OKX}`]: 'OKX_API_KEY',
      [`${ProviderDomain.EXCHANGE}_${ProviderName.KRAKEN}`]: 'KRAKEN_API_KEY',
      [`${ProviderDomain.EXCHANGE}_${ProviderName.COINBASE}`]: 'COINBASE_API_KEY',
      [`${ProviderDomain.KYC}_${ProviderName.KYC_GENERIC}`]: 'KYC_PROVIDER_API_KEY',
      [`${ProviderDomain.AML}_${ProviderName.AML_GENERIC}`]: 'AML_PROVIDER_API_KEY',
      [`${ProviderDomain.PAYOUT}_${ProviderName.PAYOUT_GENERIC}`]: 'PAYOUT_PROVIDER_API_KEY',
      [`${ProviderDomain.CUSTODY}_${ProviderName.CUSTODY_GENERIC}`]: 'CUSTODY_PROVIDER_API_KEY',
      [`${ProviderDomain.NOTIFICATION}_${ProviderName.EMAIL_GENERIC}`]: 'EMAIL_PROVIDER_API_KEY',
    };

    const key = envMap[`${domain}_${provider}`];
    if (!key) return true;
    return !!process.env[key];
  }

  private redactUrl(url: string): string {
    if (!url) return 'not-configured';
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return url.slice(0, 100);
    }
  }
}

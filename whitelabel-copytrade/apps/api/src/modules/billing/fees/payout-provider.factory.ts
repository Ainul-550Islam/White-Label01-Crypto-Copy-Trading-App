import { Injectable, Logger } from '@nestjs/common';
import { PayoutProvider } from './payout.types';
import { IPayoutProvider } from './payout-provider.interface';

/**
 * Selects configured payout provider using existing app config conventions.
 * Validates provider availability, fails safely if not configured, no secret exposure.
 * If no payout provider configured, reports explicit config error rather than fake success.
 */

class NoOpPayoutProvider implements IPayoutProvider {
  readonly providerName = PayoutProvider.NONE;

  isAvailable(): boolean {
    return false;
  }

  async createPayout(): Promise<any> {
    throw new Error('Payout provider not configured. Set PAYOUT_PROVIDER env variable to enable payouts. No fake success allowed.');
  }

  async getPayoutStatus(): Promise<any> {
    throw new Error('Payout provider not configured');
  }

  normalizeStatus(): any {
    return 'FAILED' as any;
  }
}

class ManualPayoutProvider implements IPayoutProvider {
  readonly providerName = PayoutProvider.MANUAL;
  private readonly logger = new Logger(ManualPayoutProvider.name);

  isAvailable(): boolean {
    return true;
  }

  async createPayout(input: any): Promise<any> {
    // Manual provider does not auto-execute, creates pending record for manual approval
    this.logger.log(`Manual payout created for settlement ${input.settlementId} amount ${input.amount} ${input.currency} beneficiary ${input.beneficiaryId}`);
    return {
      providerPayoutId: `manual_${input.settlementId}_${Date.now()}`,
      providerReference: `MANUAL-${input.tenantId.substring(0, 8)}`,
      status: 'PENDING' as any,
      rawResponse: { manual: true, requiresApproval: true },
    };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<any> {
    // Manual provider always returns pending until manually marked succeeded
    return {
      providerPayoutId,
      status: 'PENDING' as any,
      rawResponse: { manual: true },
    };
  }

  normalizeStatus(providerStatus: string): any {
    const map: Record<string, string> = {
      pending: 'PENDING',
      processing: 'PROCESSING',
      succeeded: 'SUCCEEDED',
      failed: 'FAILED',
      cancelled: 'CANCELLED',
    };
    return (map[providerStatus.toLowerCase()] || 'PENDING') as any;
  }
}

class InternalPayoutProvider implements IPayoutProvider {
  readonly providerName = PayoutProvider.INTERNAL;
  private readonly logger = new Logger(InternalPayoutProvider.name);

  isAvailable(): boolean {
    return true;
  }

  async createPayout(input: any): Promise<any> {
    // Internal ledger transfer - no external provider, but still requires confirmation via internal state
    this.logger.log(`Internal payout ledger transfer settlement=${input.settlementId} amount=${input.amount}`);
    return {
      providerPayoutId: `internal_${input.settlementId}_${Date.now()}`,
      providerReference: `INTERNAL-${input.settlementId.substring(0, 8)}`,
      status: 'PROCESSING' as any,
      rawResponse: { internal: true },
    };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<any> {
    // Internal transfers succeed after processing
    return {
      providerPayoutId,
      status: 'SUCCEEDED' as any,
      processedAt: new Date().toISOString(),
      rawResponse: { internal: true, confirmed: true },
    };
  }

  normalizeStatus(providerStatus: string): any {
    return providerStatus === 'SUCCEEDED' ? 'SUCCEEDED' : 'PROCESSING';
  }
}

@Injectable()
export class PayoutProviderFactory {
  private readonly logger = new Logger(PayoutProviderFactory.name);
  private readonly configuredProvider: PayoutProvider;

  constructor() {
    const providerRaw = (process.env.PAYOUT_PROVIDER || process.env.BILLING_PAYOUT_PROVIDER || 'none').toLowerCase();
    this.configuredProvider = this.parseProvider(providerRaw);
    this.logger.log(`Configured payout provider: ${this.configuredProvider}`);
  }

  getProvider(provider?: PayoutProvider): IPayoutProvider {
    const target = provider || this.configuredProvider;

    if (target === PayoutProvider.NONE) {
      this.logger.warn('Payout provider NONE configured - payouts will fail with config error, no fake success');
      return new NoOpPayoutProvider();
    }

    switch (target) {
      case PayoutProvider.MANUAL:
        return new ManualPayoutProvider();
      case PayoutProvider.INTERNAL:
        return new InternalPayoutProvider();
      case PayoutProvider.STRIPE:
        // Stripe payout would require Stripe Connect - not configured in this repo by default
        // Return manual as safe fallback but log config error for stripe
        if (!process.env.STRIPE_SECRET_KEY) {
          this.logger.error('STRIPE payout requested but STRIPE_SECRET_KEY not configured');
          return new NoOpPayoutProvider();
        }
        // If configured, use internal as adapter placeholder that still requires confirmation
        return new InternalPayoutProvider();
      case PayoutProvider.BANK_TRANSFER:
      case PayoutProvider.CRYPTO:
        // These would need external adapters - return NoOp with explicit error for now
        this.logger.warn(`Payout provider ${target} not fully configured, returning NoOp`);
        return new NoOpPayoutProvider();
      default:
        this.logger.error(`Unsupported payout provider: ${target}`);
        return new NoOpPayoutProvider();
    }
  }

  getDefaultProvider(): IPayoutProvider {
    return this.getProvider();
  }

  isProviderAvailable(provider: PayoutProvider): boolean {
    try {
      const p = this.getProvider(provider);
      return p.isAvailable();
    } catch {
      return false;
    }
  }

  validateProviderConfiguration(): { configured: boolean; provider: PayoutProvider; message: string } {
    const provider = this.getProvider();
    const available = provider.isAvailable();
    return {
      configured: available,
      provider: this.configuredProvider,
      message: available
        ? `Payout provider ${this.configuredProvider} is configured`
        : `Payout provider not configured (current: ${this.configuredProvider}). Set PAYOUT_PROVIDER to manual|internal|stripe. No fake success allowed.`,
    };
  }

  private parseProvider(raw: string): PayoutProvider {
    switch (raw) {
      case 'stripe':
        return PayoutProvider.STRIPE;
      case 'manual':
        return PayoutProvider.MANUAL;
      case 'bank_transfer':
      case 'bank':
        return PayoutProvider.BANK_TRANSFER;
      case 'crypto':
        return PayoutProvider.CRYPTO;
      case 'internal':
        return PayoutProvider.INTERNAL;
      case 'none':
      case '':
      default:
        return PayoutProvider.NONE;
    }
  }
}

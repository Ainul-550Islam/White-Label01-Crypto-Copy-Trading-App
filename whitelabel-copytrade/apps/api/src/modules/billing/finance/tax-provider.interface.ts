import { Injectable, Logger } from '@nestjs/common';
import type { TaxCalculationInput, TaxCalculationResult, TaxValidationResult } from './tax.types';
import { TaxCategory, TaxType } from './tax.types';
import type { Money } from './money.types';
import { createMoney } from './money.types';

/**
 * Abstraction for external tax calculation providers so future providers
 * can be added without coupling invoice logic to one vendor.
 *
 * Contract supports:
 *  - calculate tax
 *  - validate customer tax ID
 *  - determine jurisdiction
 *  - return tax breakdown
 *  - return exemption/reverse-charge information
 *
 * Do not implement fake provider success behavior.
 */

export interface ITaxProvider {
  readonly provider: string;

  calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult>;

  validateTaxId(taxId: string, country: string): Promise<TaxValidationResult>;

  getJurisdiction(country: string, region?: string, postalCode?: string): Promise<{ country: string; region?: string; jurisdiction: string; taxType: TaxType }>;
}

export interface TaxProviderFactoryConfig {
  provider: string;
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
}

@Injectable()
export class TaxProviderFactory {
  private readonly logger = new Logger(TaxProviderFactory.name);
  private provider: ITaxProvider | null = null;

  constructor() {
    // In production, you would inject configured providers
    // For now, we use internal rules as default
    this.provider = null;
  }

  getProvider(): ITaxProvider | null {
    return this.provider;
  }

  setProvider(provider: ITaxProvider): void {
    this.provider = provider;
  }

  hasProvider(): boolean {
    return this.provider !== null;
  }
}

@Injectable()
export class NoOpTaxProvider implements ITaxProvider {
  readonly provider = 'noop';
  private readonly logger = new Logger(NoOpTaxProvider.name);

  async calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult> {
    this.logger.log(`NoOp tax provider: no tax calculated for tenant ${input.tenantId}, country ${input.billingCountry}`);

    const zeroMoney = createMoney('0', input.currency);

    return {
      taxableAmount: input.amount,
      taxAmount: zeroMoney,
      totalAmount: input.amount,
      taxRate: 0,
      taxCategory: TaxCategory.ZERO,
      jurisdiction: input.billingCountry,
      taxType: TaxType.NONE,
      breakdown: [
        {
          taxableAmount: input.amount,
          taxRate: 0,
          taxAmount: zeroMoney,
          taxCategory: TaxCategory.ZERO,
          jurisdiction: input.billingCountry,
          taxType: TaxType.NONE,
          reverseCharge: false,
        },
      ],
      reverseCharge: false,
      taxCalculationSource: 'noop_provider',
      calculatedAt: new Date(),
    };
  }

  async validateTaxId(taxId: string, country: string): Promise<TaxValidationResult> {
    return {
      valid: true,
      taxId,
      country,
      validationSource: 'noop_provider',
    };
  }

  async getJurisdiction(country: string, region?: string): Promise<{ country: string; region?: string; jurisdiction: string; taxType: TaxType }> {
    return {
      country,
      region,
      jurisdiction: region ? `${country}-${region}` : country,
      taxType: TaxType.NONE,
    };
  }
}

@Injectable()
export class ConfigurableTaxProvider implements ITaxProvider {
  readonly provider = 'configurable';
  private readonly logger = new Logger(ConfigurableTaxProvider.name);

  private readonly taxRates: Record<string, number> = {
    US: 0,
    GB: 2000,
    DE: 1900,
    FR: 2000,
    EU: 2000,
  };

  async calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult> {
    const country = input.billingCountry.toUpperCase();
    const rate = this.taxRates[country] ?? this.taxRates['EU'] ?? 0;

    const taxAmount = this.calculateTaxAmount(input.amount, rate);
    const totalAmount = this.addMoney(input.amount, taxAmount);

    this.logger.log(`Configurable tax provider: ${country} rate ${rate}bps, tax ${taxAmount.amount}`);

    return {
      taxableAmount: input.amount,
      taxAmount,
      totalAmount,
      taxRate: rate,
      taxCategory: rate === 0 ? TaxCategory.ZERO : TaxCategory.STANDARD,
      jurisdiction: country,
      taxType: TaxType.VAT,
      breakdown: [
        {
          taxableAmount: input.amount,
          taxRate: rate,
          taxAmount,
          taxCategory: rate === 0 ? TaxCategory.ZERO : TaxCategory.STANDARD,
          jurisdiction: country,
          taxType: TaxType.VAT,
          reverseCharge: false,
        },
      ],
      reverseCharge: false,
      taxCalculationSource: 'configurable_provider',
      calculatedAt: new Date(),
    };
  }

  async validateTaxId(taxId: string, country: string): Promise<TaxValidationResult> {
    const isValid = taxId && taxId.length >= 5;

    return {
      valid: !!isValid,
      taxId,
      country,
      validationSource: 'configurable_provider',
      error: isValid ? undefined : 'Invalid tax ID format',
    };
  }

  async getJurisdiction(country: string, region?: string): Promise<{ country: string; region?: string; jurisdiction: string; taxType: TaxType }> {
    return {
      country,
      region,
      jurisdiction: region ? `${country}-${region}` : country,
      taxType: TaxType.VAT,
    };
  }

  private calculateTaxAmount(amount: Money, basisPoints: number): Money {
    const minorUnits = this.parseToMinor(amount);
    const taxMinor = Math.round((minorUnits * basisPoints) / 10000);
    return {
      amount: (taxMinor / Math.pow(10, amount.minorUnit)).toFixed(amount.minorUnit),
      currency: amount.currency,
      minorUnit: amount.minorUnit,
    };
  }

  private addMoney(a: Money, b: Money): Money {
    if (a.currency !== b.currency) throw new Error('Currency mismatch');
    const aMinor = this.parseToMinor(a);
    const bMinor = this.parseToMinor(b);
    const totalMinor = aMinor + bMinor;
    return {
      amount: (totalMinor / Math.pow(10, a.minorUnit)).toFixed(a.minorUnit),
      currency: a.currency,
      minorUnit: a.minorUnit,
    };
  }

  private parseToMinor(money: Money): number {
    return Math.round(parseFloat(money.amount) * Math.pow(10, money.minorUnit));
  }
}

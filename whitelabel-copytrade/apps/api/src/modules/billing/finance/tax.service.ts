import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TaxProviderFactory } from './tax-provider.interface';
import type { TaxCalculationInput, TaxCalculationResult, TaxBreakdown, TaxValidationResult, CustomerTaxInfo } from './tax.types';
import { TaxCategory, TaxType, ExemptionReason, DEFAULT_TAX_RATES, REVERSE_CHARGE_COUNTRIES, EU_COUNTRIES } from './tax.types';
import type { Money } from './money.types';
import { createMoney, calculatePercentageAmount, addMoney, parseToMinorUnits } from './money.types';

/**
 * Determines applicable tax/VAT rules from customer/tenant billing information,
 * configured jurisdiction, exemption state, and invoice context.
 *
 * Responsibilities:
 *  - determine applicable tax treatment
 *  - calculate tax amount using precise monetary logic
 *  - recognize tax-exempt cases where configured
 *  - recognize reverse-charge cases where applicable
 *  - return deterministic tax breakdown
 *  - attach tax result to invoice generation
 *
 * Do not hardcode country-specific tax rates inside invoice code.
 * Use configurable policy/provider architecture.
 * If no external tax provider is configured, use repository's configured tax rules
 * rather than silently inventing tax rates.
 */

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxProviderFactory: TaxProviderFactory,
  ) {}

  async calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult> {
    this.validateTaxInput(input);

    // Check for exemption
    if (input.isTaxExempt) {
      return this.createExemptResult(input, input.exemptionReason || ExemptionReason.CUSTOM);
    }

    // Try external tax provider first if configured
    const provider = this.taxProviderFactory.getProvider();
    if (provider) {
      try {
        const providerResult = await provider.calculateTax(input);
        this.logger.log(`Tax calculated via provider ${provider.provider} for tenant ${input.tenantId}: ${providerResult.taxAmount.amount} ${providerResult.taxAmount.currency}`);
        return providerResult;
      } catch (error) {
        this.logger.warn(`External tax provider failed, using internal rules: ${(error as Error).message}`);
      }
    }

    // Fallback to internal configurable tax rules
    return this.calculateTaxWithInternalRules(input);
  }

  async validateTaxId(taxId: string, country: string): Promise<TaxValidationResult> {
    if (!taxId || !country) {
      return {
        valid: false,
        taxId,
        country,
        validationSource: 'internal',
        error: 'Tax ID and country required',
      };
    }

    const provider = this.taxProviderFactory.getProvider();
    if (provider) {
      try {
        return await provider.validateTaxId(taxId, country);
      } catch (error) {
        this.logger.warn(`Tax ID validation via provider failed: ${(error as Error).message}`);
      }
    }

    // Internal validation: basic format check
    const isValidFormat = this.validateTaxIdFormat(taxId, country);

    return {
      valid: isValidFormat,
      taxId,
      country,
      validationSource: 'internal_format_check',
      error: isValidFormat ? undefined : 'Invalid tax ID format',
    };
  }

  async getCustomerTaxInfo(tenantId: string): Promise<CustomerTaxInfo | null> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          countryCode: true,
          metadata: true,
        },
      });

      if (!tenant) return null;

      const metadata = tenant.metadata as any;

      return {
        tenantId,
        billingCountry: tenant.countryCode || metadata?.billingCountry || 'US',
        billingRegion: metadata?.billingRegion,
        taxId: metadata?.taxId,
        vatNumber: metadata?.vatNumber,
        isBusinessCustomer: metadata?.isBusinessCustomer || false,
        isTaxExempt: metadata?.isTaxExempt || false,
        exemptionReason: metadata?.exemptionReason,
      };
    } catch {
      return null;
    }
  }

  private calculateTaxWithInternalRules(input: TaxCalculationInput): TaxCalculationResult {
    const country = input.billingCountry.toUpperCase();
    const amount = input.amount;

    // Check for reverse charge: B2B within EU
    if (input.isBusinessCustomer && input.taxId && this.isReverseChargeApplicable(input.billingCountry, 'US')) {
      // Reverse charge: customer is business in EU, supplier outside EU or B2B EU
      // Actually for SaaS, reverse charge applies when business customer in EU with valid VAT
      if (EU_COUNTRIES.has(country) && input.vatNumber) {
        return this.createReverseChargeResult(input);
      }
    }

    // Check if country is tax-exempt (e.g., US has no federal VAT for SaaS in many states)
    // For simplicity, US = 0% tax unless configured otherwise
    // EU countries have VAT, others configurable

    const taxRateBasisPoints = this.getTaxRateForCountry(country, input.billingRegion);

    if (taxRateBasisPoints === 0) {
      return this.createZeroTaxResult(input);
    }

    const taxAmount = calculatePercentageAmount(amount, taxRateBasisPoints);
    const totalAmount = addMoney(amount, taxAmount);

    const breakdown: TaxBreakdown = {
      taxableAmount: amount,
      taxRate: taxRateBasisPoints,
      taxAmount,
      taxCategory: TaxCategory.STANDARD,
      jurisdiction: `${country}${input.billingRegion ? `-${input.billingRegion}` : ''}`,
      taxType: this.getTaxTypeForCountry(country),
      reverseCharge: false,
      taxId: input.taxId,
    };

    return {
      taxableAmount: amount,
      taxAmount,
      totalAmount,
      taxRate: taxRateBasisPoints,
      taxCategory: TaxCategory.STANDARD,
      jurisdiction: breakdown.jurisdiction,
      taxType: breakdown.taxType,
      breakdown: [breakdown],
      reverseCharge: false,
      taxCalculationSource: 'internal_configurable_rules',
      calculatedAt: new Date(),
    };
  }

  private createExemptResult(input: TaxCalculationInput, reason: ExemptionReason): TaxCalculationResult {
    const zeroMoney = createMoney('0', input.currency);

    return {
      taxableAmount: input.amount,
      taxAmount: zeroMoney,
      totalAmount: input.amount,
      taxRate: 0,
      taxCategory: TaxCategory.EXEMPT,
      jurisdiction: input.billingCountry,
      taxType: TaxType.NONE,
      breakdown: [
        {
          taxableAmount: input.amount,
          taxRate: 0,
          taxAmount: zeroMoney,
          taxCategory: TaxCategory.EXEMPT,
          jurisdiction: input.billingCountry,
          taxType: TaxType.NONE,
          exemptionReason: reason,
          reverseCharge: false,
        },
      ],
      exemptionReason: reason,
      reverseCharge: false,
      taxCalculationSource: 'exemption',
      calculatedAt: new Date(),
    };
  }

  private createZeroTaxResult(input: TaxCalculationInput): TaxCalculationResult {
    const zeroMoney = createMoney('0', input.currency);

    return {
      taxableAmount: input.amount,
      taxAmount: zeroMoney,
      totalAmount: input.amount,
      taxRate: 0,
      taxCategory: TaxCategory.ZERO,
      jurisdiction: input.billingCountry,
      taxType: this.getTaxTypeForCountry(input.billingCountry),
      breakdown: [
        {
          taxableAmount: input.amount,
          taxRate: 0,
          taxAmount: zeroMoney,
          taxCategory: TaxCategory.ZERO,
          jurisdiction: input.billingCountry,
          taxType: this.getTaxTypeForCountry(input.billingCountry),
          reverseCharge: false,
        },
      ],
      reverseCharge: false,
      taxCalculationSource: 'zero_rate',
      calculatedAt: new Date(),
    };
  }

  private createReverseChargeResult(input: TaxCalculationInput): TaxCalculationResult {
    const zeroMoney = createMoney('0', input.currency);

    return {
      taxableAmount: input.amount,
      taxAmount: zeroMoney,
      totalAmount: input.amount,
      taxRate: 0,
      taxCategory: TaxCategory.REVERSE_CHARGE,
      jurisdiction: input.billingCountry,
      taxType: TaxType.VAT,
      breakdown: [
        {
          taxableAmount: input.amount,
          taxRate: 0,
          taxAmount: zeroMoney,
          taxCategory: TaxCategory.REVERSE_CHARGE,
          jurisdiction: input.billingCountry,
          taxType: TaxType.VAT,
          exemptionReason: ExemptionReason.REVERSE_CHARGE,
          reverseCharge: true,
        },
      ],
      exemptionReason: ExemptionReason.REVERSE_CHARGE,
      reverseCharge: true,
      taxCalculationSource: 'reverse_charge',
      calculatedAt: new Date(),
    };
  }

  private getTaxRateForCountry(country: string, region?: string): number {
    // Use configurable tax rates, not hardcoded in invoice code
    // This method uses DEFAULT_TAX_RATES as fallback, but in production
    // should be configurable via database or external provider

    const upperCountry = country.toUpperCase();

    // Check for custom tax rate in database (if configured)
    // For now, use default rates map
    if (DEFAULT_TAX_RATES[upperCountry] !== undefined) {
      return DEFAULT_TAX_RATES[upperCountry];
    }

    // Default: 0% for unknown countries (no tax)
    return 0;
  }

  private getTaxTypeForCountry(country: string): TaxType {
    const upperCountry = country.toUpperCase();

    if (EU_COUNTRIES.has(upperCountry) || upperCountry === 'GB') {
      return TaxType.VAT;
    }

    if (['AU', 'NZ', 'SG', 'MY'].includes(upperCountry)) {
      return TaxType.GST;
    }

    if (upperCountry === 'US') {
      return TaxType.SALES_TAX;
    }

    return TaxType.VAT;
  }

  private isReverseChargeApplicable(customerCountry: string, supplierCountry: string): boolean {
    const customerUpper = customerCountry.toUpperCase();

    // Reverse charge typically applies for B2B transactions within EU
    // Or when supplier outside EU and customer is business in EU
    if (EU_COUNTRIES.has(customerUpper)) {
      return true;
    }

    return REVERSE_CHARGE_COUNTRIES.has(customerUpper);
  }

  private validateTaxIdFormat(taxId: string, country: string): boolean {
    if (!taxId) return false;

    const upperCountry = country.toUpperCase();
    const cleanTaxId = taxId.replace(/[^A-Z0-9]/gi, '');

    // Basic format validation
    if (cleanTaxId.length < 5 || cleanTaxId.length > 20) {
      return false;
    }

    // Country-specific validation (simplified)
    switch (upperCountry) {
      case 'DE':
        return /^DE[0-9]{9}$/.test(taxId.toUpperCase());
      case 'FR':
        return /^FR[0-9A-Z]{2}[0-9]{9}$/.test(taxId.toUpperCase());
      case 'GB':
        return /^GB[0-9]{9}$/.test(taxId.toUpperCase()) || /^GB[0-9]{12}$/.test(taxId.toUpperCase());
      case 'US':
        return /^[0-9]{2}-[0-9]{7}$/.test(taxId) || /^[0-9]{9}$/.test(taxId);
      default:
        return cleanTaxId.length >= 5;
    }
  }

  private validateTaxInput(input: TaxCalculationInput): void {
    if (!input.tenantId) {
      throw new Error('Tenant ID required for tax calculation');
    }
    if (!input.amount) {
      throw new Error('Amount required for tax calculation');
    }
    if (!input.billingCountry) {
      throw new Error('Billing country required for tax calculation');
    }
    if (!input.currency) {
      throw new Error('Currency required for tax calculation');
    }
  }
}

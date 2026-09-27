import type { UUID } from '@wlct/shared-types';
import type { Money } from './money.types';

/**
 * Tax/VAT domain types: jurisdiction, tax ID, tax rate, tax category,
 * exemption state, tax breakdown, reverse-charge status, and calculation result.
 */

export enum TaxCategory {
  STANDARD = 'STANDARD',
  REDUCED = 'REDUCED',
  ZERO = 'ZERO',
  EXEMPT = 'EXEMPT',
  REVERSE_CHARGE = 'REVERSE_CHARGE',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
}

export enum TaxType {
  VAT = 'VAT',
  GST = 'GST',
  SALES_TAX = 'SALES_TAX',
  CONSUMPTION_TAX = 'CONSUMPTION_TAX',
  NONE = 'NONE',
}

export enum ExemptionReason {
  NONE = 'NONE',
  BUSINESS_CUSTOMER = 'BUSINESS_CUSTOMER',
  REVERSE_CHARGE = 'REVERSE_CHARGE',
  EXPORT = 'EXPORT',
  NON_PROFIT = 'NON_PROFIT',
  GOVERNMENT = 'GOVERNMENT',
  SMALL_BUSINESS = 'SMALL_BUSINESS',
  CUSTOM = 'CUSTOM',
}

export interface TaxJurisdiction {
  country: string;
  region?: string;
  city?: string;
  postalCode?: string;
  taxType: TaxType;
}

export interface TaxRate {
  rate: number;
  basisPoints: number;
  category: TaxCategory;
  jurisdiction: TaxJurisdiction;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

export interface CustomerTaxInfo {
  tenantId: UUID;
  billingCountry: string;
  billingRegion?: string;
  taxId?: string;
  vatNumber?: string;
  isBusinessCustomer: boolean;
  isTaxExempt: boolean;
  exemptionReason?: ExemptionReason;
  exemptionCertificate?: string;
}

export interface TaxCalculationInput {
  tenantId: UUID;
  amount: Money;
  currency: string;
  billingCountry: string;
  billingRegion?: string;
  taxId?: string;
  vatNumber?: string;
  isBusinessCustomer: boolean;
  isTaxExempt?: boolean;
  exemptionReason?: ExemptionReason;
  productType?: string;
  customerId?: UUID;
}

export interface TaxBreakdown {
  taxableAmount: Money;
  taxRate: number;
  taxAmount: Money;
  taxCategory: TaxCategory;
  jurisdiction: string;
  taxType: TaxType;
  exemptionReason?: ExemptionReason;
  reverseCharge: boolean;
  taxId?: string;
}

export interface TaxCalculationResult {
  taxableAmount: Money;
  taxAmount: Money;
  totalAmount: Money;
  taxRate: number;
  taxCategory: TaxCategory;
  jurisdiction: string;
  taxType: TaxType;
  breakdown: TaxBreakdown[];
  exemptionReason?: ExemptionReason;
  reverseCharge: boolean;
  taxCalculationSource: string;
  calculatedAt: Date;
}

export interface TaxValidationResult {
  valid: boolean;
  taxId: string;
  country: string;
  validationSource: string;
  companyName?: string;
  address?: string;
  error?: string;
}

export interface TaxProviderConfig {
  provider: string;
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  defaultTaxRate?: number;
  exemptCountries?: string[];
  reverseChargeCountries?: string[];
  vatNumberRequiredCountries?: string[];
}

export interface TaxRecord {
  id: UUID;
  tenantId: UUID;
  invoiceId: UUID | null;
  paymentId: UUID | null;
  taxType: TaxType;
  taxCategory: TaxCategory;
  jurisdiction: string;
  country: string;
  region: string | null;
  taxRate: number;
  taxableAmount: string;
  taxAmount: string;
  currency: string;
  exemptionReason: ExemptionReason | null;
  reverseCharge: boolean;
  taxId: string | null;
  calculationSource: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_TAX_RATES: Record<string, number> = {
  US: 0,
  GB: 2000,
  DE: 1900,
  FR: 2000,
  IT: 2200,
  ES: 2100,
  NL: 2100,
  BE: 2100,
  AU: 1000,
  CA: 500,
  JP: 1000,
  SG: 700,
  IN: 1800,
};

export const REVERSE_CHARGE_COUNTRIES = new Set(['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'LU', 'FI', 'SE', 'DK']);

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

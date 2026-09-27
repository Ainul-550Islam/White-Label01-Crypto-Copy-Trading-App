import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { FinanceAuditService } from './finance.audit';
import type { UUID } from '@wlct/shared-types';

/**
 * Tenant billing profile: normalized customer record with billing name,
 * legal/business name, billing email, billing address (line1/line2/city/
 * region/postal/country), tax ID, VAT number, preferred currency, provider
 * customer references. Does not duplicate authentication identity or
 * subscription record. No sensitive data logged.
 */

export interface BillingCustomerProfile {
  id: UUID;
  tenantId: UUID;
  billingName: string;
  legalName: string | null;
  businessName: string | null;
  billingEmail: string;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingRegion: string | null;
  billingPostalCode: string | null;
  billingCountry: string;
  taxId: string | null;
  vatNumber: string | null;
  preferredCurrency: string;
  providerCustomerId: string | null;
  provider: string | null;
  isBusinessCustomer: boolean;
  isTaxExempt: boolean;
  exemptionReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBillingCustomerInput {
  tenantId: UUID;
  billingName: string;
  billingEmail: string;
  billingCountry: string;
  legalName?: string;
  businessName?: string;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingCity?: string;
  billingRegion?: string;
  billingPostalCode?: string;
  taxId?: string;
  vatNumber?: string;
  preferredCurrency?: string;
  isBusinessCustomer?: boolean;
  isTaxExempt?: boolean;
  exemptionReason?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateBillingCustomerInput {
  billingName?: string;
  legalName?: string;
  businessName?: string;
  billingEmail?: string;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingCity?: string;
  billingRegion?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  taxId?: string;
  vatNumber?: string;
  preferredCurrency?: string;
  isBusinessCustomer?: boolean;
  isTaxExempt?: boolean;
  exemptionReason?: string;
  providerCustomerId?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BillingCustomerService {
  private readonly logger = new Logger(BillingCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: FinanceAuditService,
  ) {}

  async getBillingCustomer(tenantId: string): Promise<BillingCustomerProfile | null> {
    try {
      // Try dedicated billing customer model first
      const result = await (this.prisma as any).billingCustomer?.findFirst({
        where: { tenantId },
      });

      if (result) {
        return this.mapToProfile(result);
      }

      // Fallback: build from tenant record
      return this.buildFromTenant(tenantId);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return this.buildFromTenant(tenantId);
      }
      throw error;
    }
  }

  async createOrUpdateBillingCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomerProfile> {
    this.validateCreateInput(input);

    const existing = await this.getBillingCustomer(input.tenantId);

    if (existing) {
      return this.updateBillingCustomer(input.tenantId, {
        billingName: input.billingName,
        billingEmail: input.billingEmail,
        billingCountry: input.billingCountry,
        legalName: input.legalName,
        businessName: input.businessName,
        billingAddressLine1: input.billingAddressLine1,
        billingAddressLine2: input.billingAddressLine2,
        billingCity: input.billingCity,
        billingRegion: input.billingRegion,
        billingPostalCode: input.billingPostalCode,
        taxId: input.taxId,
        vatNumber: input.vatNumber,
        preferredCurrency: input.preferredCurrency,
        isBusinessCustomer: input.isBusinessCustomer,
        isTaxExempt: input.isTaxExempt,
        exemptionReason: input.exemptionReason,
        metadata: input.metadata,
      });
    }

    try {
      const data = {
        id: this.generateId(),
        tenantId: input.tenantId,
        billingName: input.billingName,
        legalName: input.legalName || null,
        businessName: input.businessName || null,
        billingEmail: input.billingEmail,
        billingAddressLine1: input.billingAddressLine1 || null,
        billingAddressLine2: input.billingAddressLine2 || null,
        billingCity: input.billingCity || null,
        billingRegion: input.billingRegion || null,
        billingPostalCode: input.billingPostalCode || null,
        billingCountry: input.billingCountry,
        taxId: input.taxId || null,
        vatNumber: input.vatNumber || null,
        preferredCurrency: input.preferredCurrency || 'USD',
        providerCustomerId: null,
        provider: null,
        isBusinessCustomer: input.isBusinessCustomer || false,
        isTaxExempt: input.isTaxExempt || false,
        exemptionReason: input.exemptionReason || null,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await (this.prisma as any).billingCustomer?.create({ data });

      if (!result) {
        // Model doesn't exist, store in tenant metadata
        return this.storeInTenantMetadata(input);
      }

      const profile = this.mapToProfile(result);

      await this.auditService.logBillingCustomerUpdated(input.tenantId, profile.id, 'CREATE');

      this.logger.log(`Billing customer created: ${profile.id} for tenant ${input.tenantId}`);

      return profile;
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return this.storeInTenantMetadata(input);
      }
      throw error;
    }
  }

  async updateBillingCustomer(tenantId: string, input: UpdateBillingCustomerInput): Promise<BillingCustomerProfile> {
    this.validateUpdateInput(input);

    try {
      const existing = await (this.prisma as any).billingCustomer?.findFirst({
        where: { tenantId },
      });

      if (existing) {
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (input.billingName !== undefined) updateData.billingName = input.billingName;
        if (input.legalName !== undefined) updateData.legalName = input.legalName || null;
        if (input.businessName !== undefined) updateData.businessName = input.businessName || null;
        if (input.billingEmail !== undefined) updateData.billingEmail = input.billingEmail;
        if (input.billingAddressLine1 !== undefined) updateData.billingAddressLine1 = input.billingAddressLine1 || null;
        if (input.billingAddressLine2 !== undefined) updateData.billingAddressLine2 = input.billingAddressLine2 || null;
        if (input.billingCity !== undefined) updateData.billingCity = input.billingCity || null;
        if (input.billingRegion !== undefined) updateData.billingRegion = input.billingRegion || null;
        if (input.billingPostalCode !== undefined) updateData.billingPostalCode = input.billingPostalCode || null;
        if (input.billingCountry !== undefined) updateData.billingCountry = input.billingCountry;
        if (input.taxId !== undefined) updateData.taxId = input.taxId || null;
        if (input.vatNumber !== undefined) updateData.vatNumber = input.vatNumber || null;
        if (input.preferredCurrency !== undefined) updateData.preferredCurrency = input.preferredCurrency;
        if (input.isBusinessCustomer !== undefined) updateData.isBusinessCustomer = input.isBusinessCustomer;
        if (input.isTaxExempt !== undefined) updateData.isTaxExempt = input.isTaxExempt;
        if (input.exemptionReason !== undefined) updateData.exemptionReason = input.exemptionReason || null;
        if (input.providerCustomerId !== undefined) updateData.providerCustomerId = input.providerCustomerId || null;
        if (input.provider !== undefined) updateData.provider = input.provider || null;
        if (input.metadata !== undefined) updateData.metadata = input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : null;

        const result = await (this.prisma as any).billingCustomer?.update({
          where: { id: existing.id },
          data: updateData,
        });

        const profile = this.mapToProfile(result);

        await this.auditService.logBillingCustomerUpdated(tenantId, profile.id, 'UPDATE');

        this.logger.log(`Billing customer updated: ${profile.id} for tenant ${tenantId}`);

        return profile;
      }

      // No dedicated model - update tenant metadata
      return this.updateTenantMetadata(tenantId, input);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return this.updateTenantMetadata(tenantId, input);
      }
      throw error;
    }
  }

  async linkProviderCustomer(tenantId: string, providerCustomerId: string, provider: string): Promise<BillingCustomerProfile | null> {
    const existing = await this.getBillingCustomer(tenantId);

    if (!existing) {
      this.logger.warn(`No billing customer found for tenant ${tenantId}, cannot link provider customer`);
      return null;
    }

    return this.updateBillingCustomer(tenantId, {
      providerCustomerId,
      provider,
    });
  }

  private async buildFromTenant(tenantId: string): Promise<BillingCustomerProfile | null> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          countryCode: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!tenant) return null;

      const metadata = tenant.metadata as any;
      const billingData = metadata?.billingCustomer || metadata?.billing || {};

      return {
        id: tenant.id,
        tenantId: tenant.id,
        billingName: billingData.billingName || tenant.name || 'Unknown',
        legalName: billingData.legalName || null,
        businessName: billingData.businessName || null,
        billingEmail: billingData.billingEmail || metadata?.email || '',
        billingAddressLine1: billingData.billingAddressLine1 || null,
        billingAddressLine2: billingData.billingAddressLine2 || null,
        billingCity: billingData.billingCity || null,
        billingRegion: billingData.billingRegion || null,
        billingPostalCode: billingData.billingPostalCode || null,
        billingCountry: billingData.billingCountry || tenant.countryCode || 'US',
        taxId: billingData.taxId || null,
        vatNumber: billingData.vatNumber || null,
        preferredCurrency: billingData.preferredCurrency || 'USD',
        providerCustomerId: billingData.providerCustomerId || null,
        provider: billingData.provider || null,
        isBusinessCustomer: billingData.isBusinessCustomer || false,
        isTaxExempt: billingData.isTaxExempt || false,
        exemptionReason: billingData.exemptionReason || null,
        metadata: billingData.metadata || null,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      };
    } catch {
      return null;
    }
  }

  private async storeInTenantMetadata(input: CreateBillingCustomerInput): Promise<BillingCustomerProfile> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: input.tenantId },
        select: { metadata: true },
      });

      const existingMetadata = (tenant?.metadata as any) || {};

      const billingCustomerData = {
        billingName: input.billingName,
        legalName: input.legalName || null,
        businessName: input.businessName || null,
        billingEmail: input.billingEmail,
        billingAddressLine1: input.billingAddressLine1 || null,
        billingAddressLine2: input.billingAddressLine2 || null,
        billingCity: input.billingCity || null,
        billingRegion: input.billingRegion || null,
        billingPostalCode: input.billingPostalCode || null,
        billingCountry: input.billingCountry,
        taxId: input.taxId || null,
        vatNumber: input.vatNumber || null,
        preferredCurrency: input.preferredCurrency || 'USD',
        isBusinessCustomer: input.isBusinessCustomer || false,
        isTaxExempt: input.isTaxExempt || false,
        exemptionReason: input.exemptionReason || null,
        metadata: input.metadata || null,
      };

      await this.prisma.tenant.update({
        where: { id: input.tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            billingCustomer: billingCustomerData,
          },
        },
      });

      const updated = await this.buildFromTenant(input.tenantId);
      if (updated) {
        await this.auditService.logBillingCustomerUpdated(input.tenantId, updated.id, 'CREATE_VIA_METADATA');
        return updated;
      }
    } catch (error) {
      this.logger.warn(`Could not store billing customer in tenant metadata: ${(error as Error).message}`);
    }

    // Return in-memory profile
    return {
      id: input.tenantId,
      tenantId: input.tenantId,
      billingName: input.billingName,
      legalName: input.legalName || null,
      businessName: input.businessName || null,
      billingEmail: input.billingEmail,
      billingAddressLine1: input.billingAddressLine1 || null,
      billingAddressLine2: input.billingAddressLine2 || null,
      billingCity: input.billingCity || null,
      billingRegion: input.billingRegion || null,
      billingPostalCode: input.billingPostalCode || null,
      billingCountry: input.billingCountry,
      taxId: input.taxId || null,
      vatNumber: input.vatNumber || null,
      preferredCurrency: input.preferredCurrency || 'USD',
      providerCustomerId: null,
      provider: null,
      isBusinessCustomer: input.isBusinessCustomer || false,
      isTaxExempt: input.isTaxExempt || false,
      exemptionReason: input.exemptionReason || null,
      metadata: input.metadata || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private async updateTenantMetadata(tenantId: string, input: UpdateBillingCustomerInput): Promise<BillingCustomerProfile> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { metadata: true },
      });

      const existingMetadata = (tenant?.metadata as any) || {};
      const existingBilling = existingMetadata.billingCustomer || {};

      const updatedBilling = {
        ...existingBilling,
      };

      if (input.billingName !== undefined) updatedBilling.billingName = input.billingName;
      if (input.legalName !== undefined) updatedBilling.legalName = input.legalName || null;
      if (input.businessName !== undefined) updatedBilling.businessName = input.businessName || null;
      if (input.billingEmail !== undefined) updatedBilling.billingEmail = input.billingEmail;
      if (input.billingAddressLine1 !== undefined) updatedBilling.billingAddressLine1 = input.billingAddressLine1 || null;
      if (input.billingAddressLine2 !== undefined) updatedBilling.billingAddressLine2 = input.billingAddressLine2 || null;
      if (input.billingCity !== undefined) updatedBilling.billingCity = input.billingCity || null;
      if (input.billingRegion !== undefined) updatedBilling.billingRegion = input.billingRegion || null;
      if (input.billingPostalCode !== undefined) updatedBilling.billingPostalCode = input.billingPostalCode || null;
      if (input.billingCountry !== undefined) updatedBilling.billingCountry = input.billingCountry;
      if (input.taxId !== undefined) updatedBilling.taxId = input.taxId || null;
      if (input.vatNumber !== undefined) updatedBilling.vatNumber = input.vatNumber || null;
      if (input.preferredCurrency !== undefined) updatedBilling.preferredCurrency = input.preferredCurrency;
      if (input.isBusinessCustomer !== undefined) updatedBilling.isBusinessCustomer = input.isBusinessCustomer;
      if (input.isTaxExempt !== undefined) updatedBilling.isTaxExempt = input.isTaxExempt;
      if (input.exemptionReason !== undefined) updatedBilling.exemptionReason = input.exemptionReason || null;
      if (input.providerCustomerId !== undefined) updatedBilling.providerCustomerId = input.providerCustomerId || null;
      if (input.provider !== undefined) updatedBilling.provider = input.provider || null;
      if (input.metadata !== undefined) updatedBilling.metadata = input.metadata || null;

      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          metadata: {
            ...existingMetadata,
            billingCustomer: updatedBilling,
          },
        },
      });

      const updated = await this.buildFromTenant(tenantId);
      if (updated) {
        await this.auditService.logBillingCustomerUpdated(tenantId, updated.id, 'UPDATE_VIA_METADATA');
        return updated;
      }
    } catch (error) {
      this.logger.warn(`Could not update billing customer in tenant metadata: ${(error as Error).message}`);
    }

    // Fallback
    const existing = await this.buildFromTenant(tenantId);
    if (existing) return existing;

    throw new Error(`Billing customer not found for tenant ${tenantId}`);
  }

  private validateCreateInput(input: CreateBillingCustomerInput): void {
    if (!input.tenantId) throw new Error('Tenant ID required');
    if (!input.billingName) throw new Error('Billing name required');
    if (!input.billingEmail) throw new Error('Billing email required');
    if (!input.billingCountry) throw new Error('Billing country required');
  }

  private validateUpdateInput(input: UpdateBillingCustomerInput): void {
    // No required fields for update
  }

  private mapToProfile(raw: any): BillingCustomerProfile {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      billingName: raw.billingName,
      legalName: raw.legalName || null,
      businessName: raw.businessName || null,
      billingEmail: raw.billingEmail,
      billingAddressLine1: raw.billingAddressLine1 || null,
      billingAddressLine2: raw.billingAddressLine2 || null,
      billingCity: raw.billingCity || null,
      billingRegion: raw.billingRegion || null,
      billingPostalCode: raw.billingPostalCode || null,
      billingCountry: raw.billingCountry,
      taxId: raw.taxId || null,
      vatNumber: raw.vatNumber || null,
      preferredCurrency: raw.preferredCurrency || 'USD',
      providerCustomerId: raw.providerCustomerId || null,
      provider: raw.provider || null,
      isBusinessCustomer: raw.isBusinessCustomer || false,
      isTaxExempt: raw.isTaxExempt || false,
      exemptionReason: raw.exemptionReason || null,
      metadata: raw.metadata || null,
      createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : new Date(),
    };
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ISsoProvider } from './sso-provider.interface';
import { SsoProvider } from './security.types';
import { SamlProviderService } from './saml-provider.service';
import { OidcProviderService } from './oidc-provider.service';

/**
 * Selects tenant's configured SSO provider based on tenant/provider configuration without bypassing authentication.
 * SAML/OIDC support, explicit configuration, disabled rejected, outage becomes auth failure, no fallback to insecure when enforced.
 */

class DisabledSsoProvider implements ISsoProvider {
  readonly providerType: SsoProvider;
  readonly providerName = 'DISABLED';

  constructor(providerType: SsoProvider = SsoProvider.SAML) {
    this.providerType = providerType;
  }

  isAvailable(): boolean {
    return false;
  }

  async getMetadata(tenantId: string): Promise<any> {
    throw new Error(`SSO provider ${this.providerType} disabled for tenant ${tenantId} - explicit authentication failure, no fallback to insecure login`);
  }

  async createAuthorizationRequest(): Promise<any> {
    throw new Error(`SSO provider ${this.providerType} disabled - authentication failure, not success`);
  }

  async validateCallback(): Promise<any> {
    throw new Error(`SSO provider ${this.providerType} disabled - authentication failure`);
  }
}

@Injectable()
export class SsoProviderFactory {
  private readonly logger = new Logger(SsoProviderFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly samlProvider: SamlProviderService,
    private readonly oidcProvider: OidcProviderService,
  ) {}

  async getProvider(tenantId: string, providerType?: SsoProvider): Promise<ISsoProvider> {
    try {
      const where: any = { tenantId, isActive: true };
      if (providerType) where.providerType = providerType;

      const config = await (this.prisma as any).ssoConfiguration?.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });

      if (!config) {
        if (providerType) {
          this.logger.warn(`SSO config not found tenant=${tenantId} provider=${providerType} - explicit failure, no insecure fallback`);
          return new DisabledSsoProvider(providerType);
        }
        // Try any enabled
        const anyConfig = await (this.prisma as any).ssoConfiguration?.findFirst({
          where: { tenantId, isActive: true, state: { in: ['ENABLED', 'ENFORCED'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (!anyConfig) {
          this.logger.warn(`No SSO config for tenant=${tenantId} - disabled`);
          return new DisabledSsoProvider();
        }
        return this.resolveProviderFromConfig(anyConfig);
      }

      if (config.state === 'DISABLED' || !config.isActive) {
        this.logger.warn(`SSO provider disabled tenant=${tenantId} provider=${config.providerType} state=${config.state}`);
        return new DisabledSsoProvider(config.providerType as SsoProvider);
      }

      return this.resolveProviderFromConfig(config);
    } catch (e: any) {
      this.logger.warn(`Failed to get SSO provider tenant=${tenantId}: ${e.message} - explicit failure`);
      return new DisabledSsoProvider(providerType);
    }
  }

  async getProviderByType(providerType: SsoProvider): Promise<ISsoProvider> {
    switch (providerType) {
      case SsoProvider.SAML:
        return this.samlProvider;
      case SsoProvider.OIDC:
        return this.oidcProvider;
      default:
        this.logger.warn(`Unknown SSO provider type ${providerType} - rejected`);
        return new DisabledSsoProvider(providerType);
    }
  }

  async isSsoEnabled(tenantId: string): Promise<boolean> {
    const provider = await this.getProvider(tenantId);
    return provider.isAvailable();
  }

  async isSsoEnforced(tenantId: string): Promise<boolean> {
    try {
      const config = await (this.prisma as any).ssoConfiguration?.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return config?.enforced === true && config?.state === 'ENFORCED';
    } catch {
      return false;
    }
  }

  private resolveProviderFromConfig(config: any): ISsoProvider {
    switch (config.providerType) {
      case 'SAML':
      case SsoProvider.SAML:
        return this.samlProvider;
      case 'OIDC':
      case SsoProvider.OIDC:
        return this.oidcProvider;
      default:
        this.logger.warn(`Unknown provider type in config ${config.providerType}`);
        return new DisabledSsoProvider(config.providerType as SsoProvider);
    }
  }

  async listTenantProviders(tenantId: string): Promise<any[]> {
    try {
      const configs = await (this.prisma as any).ssoConfiguration?.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }) || [];
      return configs.map((c: any) => ({
        id: c.id,
        tenantId: c.tenantId,
        providerType: c.providerType,
        state: c.state,
        issuer: c.issuer,
        audience: c.audience,
        enforced: c.enforced,
        jitEnabled: c.jitEnabled,
        isActive: c.isActive,
        allowedDomains: c.allowedDomains,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
    } catch {
      return [];
    }
  }
}

import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { X509Certificate, createPrivateKey, type KeyObject } from 'crypto';
import type { SealedPayload } from '@wlct/utils';
import type { Prisma, SsoConfiguration } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { SsoProviderFactory } from './sso-provider.factory';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { SamlProviderService, samlSpDecryptionKeyAad, samlSpSigningKeyAad } from './saml-provider.service';
import { ssoClientSecretAad } from './oidc-provider.service';
import { SsoProvider, SecurityEventType, SecurityRisk } from './security.types';
import { SSO_ASYMMETRIC_ALGORITHMS, SsoAuthError, isAllowedSsoUrl } from './sso-flow.types';

export interface SsoConfigurationInput {
  tenantId: string;
  providerType: SsoProvider;
  issuer?: string;
  audience?: string;
  clientId?: string;
  /** Write-only; envelope-encrypted before storage and never returned. */
  clientSecret?: string;
  metadataUrl?: string;
  entityId?: string;
  acsUrl?: string;
  ssoUrl?: string;
  certificate?: string;
  allowedDomains?: string[];
  enforced?: boolean;
  jitEnabled?: boolean;
  defaultRole?: string;
  discoveryUrl?: string;
  jwksUrl?: string;
  scopes?: string[];
  redirectUri?: string;
  tokenEndpointAuthMethod?: string;
  pkceRequired?: boolean;
  clockSkewSec?: number;
  maxAuthAgeSec?: number;
  allowedAlgorithms?: string[];
  wantResponseSigned?: boolean;
  /** SAML opt-in: require encrypted assertions. */
  wantAssertionsEncrypted?: boolean;
  /** SAML: SP RSA private key (PEM). Write-only; envelope-encrypted before storage, never returned. */
  spDecryptionPrivateKey?: string;
  /** SAML: certificate of that key (PEM), handed to the IdP. */
  spEncryptionCertificate?: string;
  /** SAML Single Logout: IdP SingleLogoutService URL (HTTP-Redirect binding). */
  sloUrl?: string;
  /** SAML Single Logout: our SingleLogoutService URL (…/v1/auth/sso/saml/slo), registered at the IdP. */
  logoutCallbackUrl?: string;
  /** SAML Single Logout: SP RSA signing key (PEM). Write-only; envelope-encrypted, never returned. */
  spSigningPrivateKey?: string;
  /** SAML Single Logout: certificate of that key (PEM), handed to the IdP. */
  spSigningCertificate?: string;
  isActive?: boolean;
  actorId: string;
  /**
   * True when the actor is platform staff. Platform staff are the break-glass
   * path and may enforce without having signed in through the tenant's IdP;
   * tenant administrators may not (see assertEnforcementWillNotLockOut).
   */
  actorIsPlatform?: boolean;
  ipHash?: string;
  requestId?: string;
}

/** What the API reports about a configuration. Secrets and certificates are never echoed. */
export interface SsoConfigurationView {
  id: string;
  tenantId: string;
  providerType: string;
  state: string;
  issuer: string | null;
  audience: string | null;
  clientId: string | null;
  entityId: string | null;
  acsUrl: string | null;
  ssoUrl: string | null;
  redirectUri: string | null;
  discoveryUrl: string | null;
  jwksUrl: string | null;
  scopes: string[];
  tokenEndpointAuthMethod: string;
  pkceRequired: boolean;
  clockSkewSec: number;
  maxAuthAgeSec: number | null;
  allowedAlgorithms: string[];
  wantResponseSigned: boolean;
  wantAssertionsEncrypted: boolean;
  /** True when an SP decryption key is stored (the key itself is never returned). */
  hasSpDecryptionKey: boolean;
  /** Public SP encryption certificate, so the administrator can give it to the IdP. */
  spEncryptionCertificate: string | null;
  /** SAML Single Logout: the IdP SLO URL. */
  sloUrl: string | null;
  /** SAML Single Logout: our SLO URL. */
  logoutCallbackUrl: string | null;
  /** True when an SP signing key is stored (the key itself is never returned). */
  hasSpSigningKey: boolean;
  /** Public SP signing certificate, so the administrator can give it to the IdP. */
  spSigningCertificate: string | null;
  hasClientSecret: boolean;
  hasCertificate: boolean;
  enforced: boolean;
  jitEnabled: boolean;
  isActive: boolean;
  allowedDomains: string[];
}

const TOKEN_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'none'];
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Tenant SSO configuration and enforcement.
 *
 * The login flow itself (transactions, code redemption, assertion
 * verification, identity mapping, session issuance) lives in
 * modules/auth/sso; this service manages the configuration those flows
 * read. Configuration changes are validated before they are stored:
 *  - every endpoint / redirect URL must pass isAllowedSsoUrl (https);
 *  - SAML certificates must parse as X.509 and at least one must be valid now;
 *  - the OIDC client secret is envelope-encrypted with AAD bound to the
 *    tenant and provider, and is never returned (only hasClientSecret);
 *  - updates are partial: fields that are not supplied are left unchanged;
 *  - a tenant administrator can only leave a configuration ENFORCED after
 *    signing in through that IdP (round 7: SSO is configured by the tenant
 *    administrator, not only by platform staff, so the service itself must
 *    stop a tenant locking its own administrators out).
 */
@Injectable()
export class EnterpriseSsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssoFactory: SsoProviderFactory,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
    private readonly crypto: CryptoService,
    private readonly samlProvider: SamlProviderService,
  ) {}

  async configureSso(params: SsoConfigurationInput): Promise<SsoConfigurationView> {
    const existing = await this.prisma.ssoConfiguration.findUnique({
      where: { tenantId_providerType: { tenantId: params.tenantId, providerType: params.providerType } },
    });

    const changes = this.buildChanges(params);
    const merged = { ...(existing ?? {}), ...changes } as Partial<SsoConfiguration>;
    this.validateSpEncryption(params, existing, merged);
    this.validateSingleLogout(params, existing, merged);
    this.validateMerged(params.providerType, merged, Boolean(existing?.clientSecretCiphertext) || changes.clientSecretCiphertext !== undefined);
    await this.assertEnforcementWillNotLockOut(params, existing, merged);

    let record: SsoConfiguration;
    if (existing) {
      record = await this.prisma.ssoConfiguration.update({
        where: { id: existing.id },
        data: changes as Prisma.SsoConfigurationUpdateInput,
      });
    } else {
      record = await this.prisma.ssoConfiguration.create({
        data: {
          tenantId: params.tenantId,
          providerType: params.providerType,
          state: params.enforced ? 'ENFORCED' : 'ENABLED',
          isActive: true,
          createdById: params.actorId,
          ...changes,
        } as Prisma.SsoConfigurationUncheckedCreateInput,
      });
    }

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.actorId,
      type: SecurityEventType.SECURITY_POLICY_CHANGED,
      severity: SecurityRisk.MEDIUM,
      description: `SSO configuration ${existing ? 'updated' : 'created'} for provider ${params.providerType}`,
      safeMetadata: {
        providerType: params.providerType,
        enforced: record.enforced,
        jitEnabled: record.jitEnabled,
        clientSecretChanged: params.clientSecret !== undefined,
        certificateChanged: params.certificate !== undefined,
        spSigningKeyChanged: params.spSigningPrivateKey !== undefined,
      },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      actorId: params.actorId,
      event: 'SECURITY_POLICY_CHANGED',
      result: 'SUCCESS',
      targetType: 'SsoConfiguration',
      targetId: record.id,
      safeMetadata: { providerType: params.providerType, enforced: record.enforced, fields: Object.keys(changes).filter((k) => k !== 'clientSecretCiphertext') },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return this.toView(record);
  }

  async disableSso(params: { tenantId: string; providerType: SsoProvider; actorId: string; ipHash?: string; requestId?: string }): Promise<any> {
    const existing = await this.prisma.ssoConfiguration.findFirst({
      where: { tenantId: params.tenantId, providerType: params.providerType },
    });

    if (!existing) {
      throw new BadRequestException(`SSO configuration not found for provider ${params.providerType}`);
    }

    // Check platform policy - cannot disable if platform enforces SSO
    const platformPolicy = await this.policyService.getPlatformPolicy();
    if (platformPolicy.ssoEnforced) {
      throw new ForbiddenException('Cannot disable SSO when platform enforces it');
    }

    const updated = await this.prisma.ssoConfiguration.update({
      where: { id: existing.id },
      data: { state: 'DISABLED', isActive: false },
    });

    // Emergency disable: unfinished logins for this provider die immediately.
    await this.prisma.ssoAuthTransaction.updateMany({
      where: { tenantId: params.tenantId, configurationId: existing.id, status: { in: ['PENDING', 'VERIFIED'] } },
      data: { status: 'REJECTED', failureReason: 'PROVIDER_DISABLED', consumedAt: new Date() },
    });

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.actorId,
      type: SecurityEventType.SECURITY_POLICY_CHANGED,
      severity: SecurityRisk.HIGH,
      description: `SSO disabled for provider ${params.providerType}`,
      safeMetadata: { providerType: params.providerType },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      actorId: params.actorId,
      event: 'SECURITY_POLICY_CHANGED',
      result: 'SUCCESS',
      targetType: 'SsoConfiguration',
      targetId: existing.id,
      safeMetadata: { providerType: params.providerType, action: 'DISABLED' },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return { id: updated.id, state: updated.state, isActive: updated.isActive };
  }

  async getSsoStatus(tenantId: string): Promise<{ enabled: boolean; enforced: boolean; providers: any[] }> {
    const providers = await this.ssoFactory.listTenantProviders(tenantId);
    const enabled = providers.some((p: any) => p.isActive && (p.state === 'ENABLED' || p.state === 'ENFORCED'));
    const enforced = providers.some((p: any) => p.enforced && p.state === 'ENFORCED');
    return { enabled, enforced, providers };
  }

  async enforceSsoCheck(tenantId: string, userEmail?: string): Promise<{ ssoRequired: boolean; providerType?: SsoProvider }> {
    const isEnforced = await this.ssoFactory.isSsoEnforced(tenantId);
    if (!isEnforced) {
      return { ssoRequired: false };
    }

    const providers = await this.ssoFactory.listTenantProviders(tenantId);
    const enforcedProvider = providers.find((p: any) => p.enforced && p.state === 'ENFORCED' && p.isActive);

    if (!enforcedProvider) {
      return { ssoRequired: false };
    }

    // Check domain restriction if email provided
    if (userEmail && enforcedProvider.allowedDomains && enforcedProvider.allowedDomains.length > 0) {
      const domain = userEmail.split('@')[1]?.toLowerCase();
      if (!enforcedProvider.allowedDomains.map((d: string) => d.toLowerCase()).includes(domain)) {
        return { ssoRequired: false };
      }
    }

    return { ssoRequired: true, providerType: enforcedProvider.providerType as SsoProvider };
  }

  toView(record: SsoConfiguration): SsoConfigurationView {
    return {
      id: record.id,
      tenantId: record.tenantId,
      providerType: record.providerType,
      state: record.state,
      issuer: record.issuer,
      audience: record.audience,
      clientId: record.clientId,
      entityId: record.entityId,
      acsUrl: record.acsUrl,
      ssoUrl: record.ssoUrl,
      redirectUri: record.redirectUri,
      discoveryUrl: record.discoveryUrl,
      jwksUrl: record.jwksUrl,
      scopes: record.scopes,
      tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
      pkceRequired: record.pkceRequired,
      clockSkewSec: record.clockSkewSec,
      maxAuthAgeSec: record.maxAuthAgeSec,
      allowedAlgorithms: record.allowedAlgorithms,
      wantResponseSigned: record.wantResponseSigned,
      wantAssertionsEncrypted: record.wantAssertionsEncrypted,
      hasSpDecryptionKey: record.spDecryptionKeyCiphertext !== null && record.spDecryptionKeyCiphertext !== undefined,
      spEncryptionCertificate: record.spEncryptionCertificate,
      sloUrl: record.sloUrl ?? null,
      logoutCallbackUrl: record.logoutCallbackUrl ?? null,
      hasSpSigningKey: record.spSigningKeyCiphertext !== null && record.spSigningKeyCiphertext !== undefined,
      spSigningCertificate: record.spSigningCertificate ?? null,
      hasClientSecret: record.clientSecretCiphertext !== null && record.clientSecretCiphertext !== undefined,
      hasCertificate: Boolean(record.certificate),
      enforced: record.enforced,
      jitEnabled: record.jitEnabled,
      isActive: record.isActive,
      allowedDomains: record.allowedDomains,
    };
  }

  /**
   * Enforcement closes password login for the configuration's domains (see
   * AuthService.assertPasswordLoginAllowed). A tenant administrator who
   * enforces a configuration that does not work for them - wrong certificate,
   * wrong issuer, a typo in the client id - would lock the tenant's
   * administrators out until platform staff intervene. So when the result of
   * this change is an ENFORCED, active configuration and the actor is not
   * platform staff, the actor must already hold an SSO identity linked to THIS
   * configuration under the issuer the configuration will have after the
   * change. In practice: create or update without enforcement, sign in with
   * SSO once, then enforce. Turning enforcement off is never blocked - that is
   * the tenant's own way back.
   */
  private async assertEnforcementWillNotLockOut(
    params: SsoConfigurationInput,
    existing: SsoConfiguration | null,
    merged: Partial<SsoConfiguration>,
  ): Promise<void> {
    if (params.actorIsPlatform === true) return;
    const resultingState = merged.state ?? (existing ? existing.state : 'ENABLED');
    const enforcing = merged.enforced === true && merged.isActive !== false && resultingState === 'ENFORCED';
    if (!enforcing) return;

    if (!existing) {
      throw new BadRequestException(
        'Single sign-on cannot be enforced in the same step that creates it. Save the configuration without enforcement, sign in through the identity provider once, then enforce it.',
      );
    }

    const link = await this.prisma.ssoIdentity.findFirst({
      where: { tenantId: params.tenantId, configurationId: existing.id, userId: params.actorId },
      select: { issuer: true },
    });
    if (!link || link.issuer !== merged.issuer) {
      throw new BadRequestException(
        'You have not signed in through this identity provider with its current settings. Sign in with single sign-on first, so enforcing it cannot lock administrators out.',
      );
    }
  }

  /**
   * SAML encrypted-assertion opt-in. When the resulting configuration has
   * wantAssertionsEncrypted, it must hold an SP decryption key AND an SP
   * encryption certificate, the certificate must be currently valid, and it
   * must be the certificate of that key (otherwise the IdP would encrypt to a
   * key we do not have and every login would fail). The key is RSA >= 2048
   * bits (XML Encryption key transport). The pair is re-checked whenever
   * either half changes, unsealing the stored key when only the certificate
   * is new.
   */
  private validateSpEncryption(
    params: SsoConfigurationInput,
    existing: SsoConfiguration | null,
    merged: Partial<SsoConfiguration>,
  ): void {
    if (params.providerType !== SsoProvider.SAML) {
      if (params.wantAssertionsEncrypted === true || params.spEncryptionCertificate) {
        throw new BadRequestException('Encrypted assertions apply to SAML configurations only');
      }
      return;
    }
    const touched =
      params.wantAssertionsEncrypted !== undefined ||
      params.spDecryptionPrivateKey !== undefined ||
      params.spEncryptionCertificate !== undefined;
    if (!touched || merged.wantAssertionsEncrypted !== true) return;

    if (!merged.spEncryptionCertificate) {
      throw new BadRequestException('spEncryptionCertificate is required when wantAssertionsEncrypted is set');
    }
    if (!merged.spDecryptionKeyCiphertext) {
      throw new BadRequestException('spDecryptionPrivateKey is required when wantAssertionsEncrypted is set');
    }

    let keyPem: string;
    if (params.spDecryptionPrivateKey !== undefined) {
      keyPem = params.spDecryptionPrivateKey.trim();
    } else {
      try {
        keyPem = this.crypto.decrypt(
          existing?.spDecryptionKeyCiphertext as unknown as SealedPayload,
          samlSpDecryptionKeyAad(params.tenantId),
        );
      } catch {
        throw new BadRequestException('The stored SP decryption key cannot be read; upload spDecryptionPrivateKey again');
      }
    }
    const key = this.parseSpPrivateKey(keyPem);

    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(merged.spEncryptionCertificate);
    } catch {
      throw new BadRequestException('spEncryptionCertificate is not a valid X.509 certificate');
    }
    const now = new Date();
    if (!(new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo))) {
      throw new BadRequestException('spEncryptionCertificate is not currently valid');
    }
    if (!certificate.checkPrivateKey(key)) {
      throw new BadRequestException('spEncryptionCertificate does not belong to spDecryptionPrivateKey');
    }
  }

  /**
   * SAML Single Logout (round 8). When the resulting configuration has an IdP
   * SLO URL, it must also have our SLO URL and an SP signing key + signing
   * certificate; the certificate must be currently valid and belong to the
   * key (otherwise the IdP could not verify our LogoutRequests and every
   * logout would fail at the IdP). The key is RSA >= 2048 bits. Checked
   * whenever one of the Single Logout fields changes, unsealing the stored
   * key when only the certificate is new. Clearing sloUrl turns SLO off.
   */
  private validateSingleLogout(
    params: SsoConfigurationInput,
    existing: SsoConfiguration | null,
    merged: Partial<SsoConfiguration>,
  ): void {
    const touched =
      params.sloUrl !== undefined ||
      params.logoutCallbackUrl !== undefined ||
      params.spSigningPrivateKey !== undefined ||
      params.spSigningCertificate !== undefined;
    if (!touched) return;
    if (params.providerType !== SsoProvider.SAML) {
      throw new BadRequestException('Single Logout settings apply to SAML configurations only');
    }
    if (!merged.sloUrl) return;

    if (!merged.logoutCallbackUrl) {
      throw new BadRequestException('logoutCallbackUrl is required when sloUrl is set');
    }
    if (!merged.spSigningCertificate) {
      throw new BadRequestException('spSigningCertificate is required when sloUrl is set');
    }
    if (!merged.spSigningKeyCiphertext) {
      throw new BadRequestException('spSigningPrivateKey is required when sloUrl is set');
    }

    let keyPem: string;
    if (params.spSigningPrivateKey !== undefined) {
      keyPem = params.spSigningPrivateKey.trim();
    } else {
      try {
        keyPem = this.crypto.decrypt(
          existing?.spSigningKeyCiphertext as unknown as SealedPayload,
          samlSpSigningKeyAad(params.tenantId),
        );
      } catch {
        throw new BadRequestException('The stored SP signing key cannot be read; upload spSigningPrivateKey again');
      }
    }
    const key = this.parseSpPrivateKey(keyPem, 'spSigningPrivateKey');

    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(merged.spSigningCertificate);
    } catch {
      throw new BadRequestException('spSigningCertificate is not a valid X.509 certificate');
    }
    const now = new Date();
    if (!(new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo))) {
      throw new BadRequestException('spSigningCertificate is not currently valid');
    }
    if (!certificate.checkPrivateKey(key)) {
      throw new BadRequestException('spSigningCertificate does not belong to spSigningPrivateKey');
    }
  }

  /** An RSA private key of at least 2048 bits, or a 400 naming the field. */
  private parseSpPrivateKey(pem: string, field: string = 'spDecryptionPrivateKey'): KeyObject {
    let key: KeyObject;
    try {
      key = createPrivateKey(pem.trim());
    } catch {
      throw new BadRequestException(`${field} is not a valid PEM private key`);
    }
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (key.asymmetricKeyType !== 'rsa' || bits < 2048) {
      throw new BadRequestException(`${field} must be an RSA key of at least 2048 bits`);
    }
    return key;
  }

  /** Only the supplied fields; an empty string clears an optional text field. */
  private buildChanges(params: SsoConfigurationInput): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    const text = (key: keyof SsoConfigurationInput, column: string = key as string) => {
      const value = params[key];
      if (value === undefined) return;
      changes[column] = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    };
    text('issuer');
    text('audience');
    text('clientId');
    text('metadataUrl');
    text('entityId');
    text('acsUrl');
    text('ssoUrl');
    text('defaultRole');
    text('discoveryUrl');
    text('jwksUrl');
    text('redirectUri');
    text('sloUrl');
    text('logoutCallbackUrl');
    if (params.certificate !== undefined) {
      changes.certificate = params.certificate.trim().length > 0 ? params.certificate.trim() : null;
    }
    if (params.allowedDomains !== undefined) {
      const domains = params.allowedDomains.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0);
      for (const domain of domains) {
        if (!DOMAIN_PATTERN.test(domain)) {
          throw new BadRequestException(`Invalid allowed domain: ${domain.slice(0, 64)}`);
        }
      }
      changes.allowedDomains = [...new Set(domains)];
    }
    if (params.scopes !== undefined) changes.scopes = [...new Set(params.scopes.map((s) => s.trim()).filter((s) => s.length > 0))];
    if (params.enforced !== undefined) {
      changes.enforced = params.enforced;
      changes.state = params.enforced ? 'ENFORCED' : 'ENABLED';
    }
    if (params.isActive !== undefined) {
      changes.isActive = params.isActive;
      if (!params.isActive) changes.state = 'DISABLED';
      else if (params.enforced === undefined) changes.state = 'ENABLED';
    }
    if (params.jitEnabled !== undefined) changes.jitEnabled = params.jitEnabled;
    if (params.tokenEndpointAuthMethod !== undefined) changes.tokenEndpointAuthMethod = params.tokenEndpointAuthMethod;
    if (params.pkceRequired !== undefined) changes.pkceRequired = params.pkceRequired;
    if (params.clockSkewSec !== undefined) changes.clockSkewSec = params.clockSkewSec;
    if (params.maxAuthAgeSec !== undefined) changes.maxAuthAgeSec = params.maxAuthAgeSec;
    if (params.allowedAlgorithms !== undefined) changes.allowedAlgorithms = [...new Set(params.allowedAlgorithms)];
    if (params.wantResponseSigned !== undefined) changes.wantResponseSigned = params.wantResponseSigned;
    if (params.wantAssertionsEncrypted !== undefined) changes.wantAssertionsEncrypted = params.wantAssertionsEncrypted;
    if (params.spEncryptionCertificate !== undefined) {
      changes.spEncryptionCertificate = params.spEncryptionCertificate.trim().length > 0 ? params.spEncryptionCertificate.trim() : null;
    }
    if (params.spDecryptionPrivateKey !== undefined) {
      if (params.providerType !== SsoProvider.SAML) {
        throw new BadRequestException('spDecryptionPrivateKey applies to SAML configurations only');
      }
      // Parsed before it is sealed, so a malformed key is refused instead of stored.
      this.parseSpPrivateKey(params.spDecryptionPrivateKey);
      changes.spDecryptionKeyCiphertext = this.crypto.encrypt(
        params.spDecryptionPrivateKey.trim(),
        samlSpDecryptionKeyAad(params.tenantId),
      ) as unknown as Prisma.InputJsonValue;
    }
    if (params.spSigningCertificate !== undefined) {
      changes.spSigningCertificate = params.spSigningCertificate.trim().length > 0 ? params.spSigningCertificate.trim() : null;
    }
    if (params.spSigningPrivateKey !== undefined) {
      if (params.providerType !== SsoProvider.SAML) {
        throw new BadRequestException('spSigningPrivateKey applies to SAML configurations only');
      }
      // Parsed before it is sealed, so a malformed key is refused instead of stored.
      this.parseSpPrivateKey(params.spSigningPrivateKey, 'spSigningPrivateKey');
      changes.spSigningKeyCiphertext = this.crypto.encrypt(
        params.spSigningPrivateKey.trim(),
        samlSpSigningKeyAad(params.tenantId),
      ) as unknown as Prisma.InputJsonValue;
    }
    if (params.clientSecret !== undefined) {
      changes.clientSecretCiphertext = this.crypto.encrypt(params.clientSecret, ssoClientSecretAad(params.tenantId)) as unknown as Prisma.InputJsonValue;
    }
    return changes;
  }

  private validateMerged(providerType: SsoProvider, merged: Partial<SsoConfiguration>, hasSecret: boolean): void {
    const url = (value: string | null | undefined, label: string, required: boolean) => {
      if (!value) {
        if (required) throw new BadRequestException(`${label} is required`);
        return;
      }
      if (!isAllowedSsoUrl(value)) {
        throw new BadRequestException(`${label} must be an https URL`);
      }
    };

    if (!merged.issuer) {
      throw new BadRequestException('issuer is required');
    }

    if (providerType === SsoProvider.OIDC) {
      url(merged.issuer, 'issuer', true);
      if (!merged.clientId) throw new BadRequestException('clientId is required');
      url(merged.redirectUri, 'redirectUri', true);
      url(merged.discoveryUrl, 'discoveryUrl', false);
      url(merged.jwksUrl, 'jwksUrl', false);
      url(merged.ssoUrl, 'ssoUrl', false);
      const method = merged.tokenEndpointAuthMethod ?? 'client_secret_basic';
      if (!TOKEN_AUTH_METHODS.includes(method)) {
        throw new BadRequestException('Unsupported tokenEndpointAuthMethod');
      }
      if (method !== 'none' && !hasSecret) {
        throw new BadRequestException('clientSecret is required for a confidential client');
      }
      if (method === 'none' && merged.pkceRequired === false) {
        throw new BadRequestException('A public client (tokenEndpointAuthMethod "none") must use PKCE');
      }
      for (const alg of merged.allowedAlgorithms ?? []) {
        if (!SSO_ASYMMETRIC_ALGORITHMS.includes(alg)) {
          throw new BadRequestException(`Algorithm ${alg} is not an accepted asymmetric algorithm`);
        }
      }
      const scopes = merged.scopes ?? [];
      if (scopes.length > 0 && !scopes.includes('openid')) {
        throw new BadRequestException('scopes must include openid');
      }
      return;
    }

    // SAML
    url(merged.ssoUrl, 'ssoUrl', true);
    url(merged.acsUrl, 'acsUrl', false);
    url(merged.redirectUri, 'redirectUri', false);
    url(merged.sloUrl, 'sloUrl', false);
    url(merged.logoutCallbackUrl, 'logoutCallbackUrl', false);
    if (!merged.certificate) {
      throw new BadRequestException('certificate is required');
    }
    try {
      this.samlProvider.signingCertificates(merged.certificate);
    } catch (error) {
      if (error instanceof SsoAuthError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

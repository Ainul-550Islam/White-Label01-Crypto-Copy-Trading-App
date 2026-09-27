import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { SecurityPolicyService } from './security-policy.service';
import { SamlProviderService } from './saml-provider.service';
import { OidcProviderService } from './oidc-provider.service';
import { SsoProviderFactory } from './sso-provider.factory';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRepository } from './api-key.repository';
import { SessionSecurityService } from './session-security.service';
import { DeviceTrustService } from './device-trust.service';
import { MfaPolicyService } from './mfa-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { SecurityThreatDetectionService } from './security-threat-detection.service';
import { SecurityController } from './security.controller';

/**
 * NestJS wiring for security policy, SSO, API-key management, sessions, devices, MFA policy, events, audit, threat detection, DTOs, and integrations.
 * Integrates with existing AuthModule, TenantModule, RBAC, ComplianceModule, BillingModule, UsageModule, NotificationsModule, Redis/session, audit.
 * Use forwardRef only when actual dependency cycles require it.
 */
@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    SecurityPolicyService,
    SamlProviderService,
    OidcProviderService,
    SsoProviderFactory,
    EnterpriseSsoService,
    ApiKeyService,
    ApiKeyRepository,
    SessionSecurityService,
    DeviceTrustService,
    MfaPolicyService,
    SecurityEventService,
    SecurityAuditService,
    SecurityThreatDetectionService,
  ],
  controllers: [SecurityController],
  exports: [
    SecurityPolicyService,
    SsoProviderFactory,
    SamlProviderService,
    OidcProviderService,
    EnterpriseSsoService,
    ApiKeyService,
    ApiKeyRepository,
    SessionSecurityService,
    DeviceTrustService,
    MfaPolicyService,
    SecurityEventService,
    SecurityAuditService,
    SecurityThreatDetectionService,
  ],
})
export class SecurityModule {}

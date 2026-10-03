import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant, TenantId } from '../../common/decorators/current-tenant.decorator';
import { SecurityPolicyService } from './security-policy.service';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { SsoProviderFactory } from './sso-provider.factory';
import { ApiKeyService } from './api-key.service';
import { SessionSecurityService } from './session-security.service';
import { DeviceTrustService } from './device-trust.service';
import { MfaPolicyService } from './mfa-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { SecurityThreatDetectionService } from './security-threat-detection.service';
import { CreateSamlConfigDto, CreateOidcConfigDto, UpdateSsoConfigDto } from './dto/sso-config.dto';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { CreateApiKeyDto, ListApiKeyDto, RotateApiKeyDto, RevokeApiKeyDto } from './dto/api-key.dto';
import { CreateSecurityPolicyDto, UpdateSecurityPolicyDto, SessionQueryDto, DeviceQueryDto, SecurityEventQueryDto, ThreatQueryDto } from './dto/security-policy.dto';
import { SsoProvider, ApiKeyState } from './security.types';
import { isPlatformPrincipal } from '../../common/guards/request-principal';

/**
 * RBAC-protected security API for SSO, API keys, sessions, devices, security events, and policy management.
 * Tenant security admins → own tenant, privileged platform admins → PLATFORM_MANAGE, ordinary users → only own sessions/API keys/devices.
 */

@Controller('security')
@UseGuards(AuthGuard('jwt'))
export class SecurityController {
  constructor(
    private readonly policyService: SecurityPolicyService,
    private readonly ssoService: EnterpriseSsoService,
    private readonly ssoFactory: SsoProviderFactory,
    private readonly apiKeyService: ApiKeyService,
    private readonly sessionService: SessionSecurityService,
    private readonly deviceService: DeviceTrustService,
    private readonly mfaPolicyService: MfaPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
    private readonly threatService: SecurityThreatDetectionService,
    private readonly crypto: CryptoService,
  ) {}

  /** Keyed, non-reversible client IP for audit records (never the raw address). */
  private ipHashOf(req: { ip?: string }): string | undefined {
    return req.ip ? this.crypto.hashIp(req.ip) : undefined;
  }

  // ===== Security Policy =====

  @Get('policy')
  @RequirePermissions(Permission.SECURITY_POLICY_READ, Permission.PLATFORM_MANAGE, Permission.SECURITY_EVENT_READ)
  async getPolicy(@CurrentTenant() tenant: any, @Query('tenantId') tenantIdQuery?: string) {
    const tenantId = tenantIdQuery || tenant?.tenantId || tenant?.id;
    return this.policyService.getEffectivePolicy({ tenantId });
  }

  @Get('policy/platform')
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async getPlatformPolicy() {
    return this.policyService.getPlatformPolicy();
  }

  @Post('policy')
  @RequirePermissions(Permission.SECURITY_POLICY_WRITE, Permission.PLATFORM_MANAGE)
  async createPolicy(@Body() dto: CreateSecurityPolicyDto, @CurrentUser() user: any, @Req() req: any) {
    const tenantId = dto.tenantId || null;
    return this.policyService.createOrUpdatePolicy({
      tenantId,
      policyVersion: dto.policyVersion,
      mfaRequired: dto.mfaRequired,
      mfaForPrivilegedRoles: dto.mfaForPrivilegedRoles,
      mfaForSensitiveOperations: dto.mfaForSensitiveOperations,
      sessionAbsoluteTimeoutSec: dto.sessionAbsoluteTimeoutSec,
      sessionIdleTimeoutSec: dto.sessionIdleTimeoutSec,
      maxConcurrentSessions: dto.maxConcurrentSessions,
      deviceTrustDurationDays: dto.deviceTrustDurationDays,
      apiKeyExpirationDays: dto.apiKeyExpirationDays,
      apiKeyRotationDays: dto.apiKeyRotationDays,
      ssoEnforced: dto.ssoEnforced,
      allowedSsoDomains: dto.allowedSsoDomains,
      jitProvisioning: dto.jitProvisioning,
      privilegedReauthRequired: dto.privilegedReauthRequired,
      securityNotifications: dto.securityNotifications,
      passwordMinLength: dto.passwordMinLength,
      actorId: user.userId || user.id,
    });
  }

  @Put('policy/:id')
  @RequirePermissions(Permission.SECURITY_POLICY_WRITE, Permission.PLATFORM_MANAGE)
  async updatePolicy(@Param('id') id: string, @Body() dto: UpdateSecurityPolicyDto, @CurrentUser() user: any, @Req() req: any) {
    // For simplicity, treat update as createOrUpdate with same version if provided, else fetch existing version
    const existing = await (this.policyService as any).prisma?.securityPolicy?.findUnique?.({ where: { id } });
    const policyVersion = existing?.policyVersion || `v${Date.now()}`;
    const tenantId = existing?.tenantId || null;

    return this.policyService.createOrUpdatePolicy({
      tenantId,
      policyVersion,
      mfaRequired: dto.mfaRequired,
      mfaForPrivilegedRoles: dto.mfaForPrivilegedRoles,
      mfaForSensitiveOperations: dto.mfaForSensitiveOperations,
      sessionAbsoluteTimeoutSec: dto.sessionAbsoluteTimeoutSec,
      sessionIdleTimeoutSec: dto.sessionIdleTimeoutSec,
      maxConcurrentSessions: dto.maxConcurrentSessions,
      deviceTrustDurationDays: dto.deviceTrustDurationDays,
      apiKeyExpirationDays: dto.apiKeyExpirationDays,
      apiKeyRotationDays: dto.apiKeyRotationDays,
      ssoEnforced: dto.ssoEnforced,
      allowedSsoDomains: dto.allowedSsoDomains,
      jitProvisioning: dto.jitProvisioning,
      privilegedReauthRequired: dto.privilegedReauthRequired,
      securityNotifications: dto.securityNotifications,
      passwordMinLength: dto.passwordMinLength,
      actorId: user.userId || user.id,
    });
  }

  // ===== SSO Configuration =====
  //
  // Round 7: tenant administrators (SSO_MANAGE + SECURITY_POLICY_WRITE, both in
  // the TENANT_ADMIN matrix) manage SSO for their own tenant; the tenant comes
  // from @TenantId, never from the body. PLATFORM_MANAGE used to be required as
  // well, which made SSO a super-admin-only feature. The service refuses an
  // enforcement that could lock the tenant's administrators out.

  @Post('sso/saml/config')
  @RequirePermissions(Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE)
  async configureSaml(@Body() dto: CreateSamlConfigDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.ssoService.configureSso({
      tenantId,
      providerType: SsoProvider.SAML,
      issuer: dto.issuer,
      entityId: dto.entityId,
      ssoUrl: dto.ssoUrl,
      acsUrl: dto.acsUrl,
      audience: dto.audience,
      certificate: dto.certificate,
      redirectUri: dto.redirectUri,
      wantResponseSigned: dto.wantResponseSigned,
      wantAssertionsEncrypted: dto.wantAssertionsEncrypted,
      spDecryptionPrivateKey: dto.spDecryptionPrivateKey,
      spEncryptionCertificate: dto.spEncryptionCertificate,
      sloUrl: dto.sloUrl,
      logoutCallbackUrl: dto.logoutCallbackUrl,
      spSigningPrivateKey: dto.spSigningPrivateKey,
      spSigningCertificate: dto.spSigningCertificate,
      clockSkewSec: dto.clockSkewSec,
      allowedDomains: dto.allowedDomains,
      enforced: dto.enforced,
      jitEnabled: dto.jitEnabled,
      defaultRole: dto.defaultRole,
      actorId: user.userId || user.id,
      actorIsPlatform: isPlatformPrincipal(req),
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Post('sso/oidc/config')
  @RequirePermissions(Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE)
  async configureOidc(@Body() dto: CreateOidcConfigDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.ssoService.configureSso({
      tenantId,
      providerType: SsoProvider.OIDC,
      issuer: dto.issuer,
      clientId: dto.clientId,
      clientSecret: dto.clientSecret,
      redirectUri: dto.redirectUri,
      tokenEndpointAuthMethod: dto.tokenEndpointAuthMethod,
      pkceRequired: dto.pkceRequired,
      clockSkewSec: dto.clockSkewSec,
      maxAuthAgeSec: dto.maxAuthAgeSec,
      allowedAlgorithms: dto.allowedAlgorithms,
      audience: dto.audience,
      discoveryUrl: dto.discoveryUrl,
      jwksUrl: dto.jwksUrl,
      ssoUrl: dto.ssoUrl,
      allowedDomains: dto.allowedDomains,
      enforced: dto.enforced,
      jitEnabled: dto.jitEnabled,
      defaultRole: dto.defaultRole,
      scopes: dto.scopes,
      actorId: user.userId || user.id,
      actorIsPlatform: isPlatformPrincipal(req),
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Put('sso/:providerType/config')
  @RequirePermissions(Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE)
  async updateSsoConfig(@Param('providerType') providerType: string, @Body() dto: UpdateSsoConfigDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const provider = providerType.toUpperCase() as SsoProvider;
    if (![SsoProvider.SAML, SsoProvider.OIDC].includes(provider)) {
      throw new BadRequestException(`Invalid provider type ${providerType}`);
    }
    return this.ssoService.configureSso({
      tenantId,
      providerType: provider,
      issuer: dto.issuer,
      entityId: dto.entityId,
      ssoUrl: dto.ssoUrl,
      acsUrl: dto.acsUrl,
      audience: dto.audience,
      certificate: dto.certificate,
      clientId: dto.clientId,
      clientSecret: dto.clientSecret,
      redirectUri: dto.redirectUri,
      tokenEndpointAuthMethod: dto.tokenEndpointAuthMethod,
      pkceRequired: dto.pkceRequired,
      clockSkewSec: dto.clockSkewSec,
      maxAuthAgeSec: dto.maxAuthAgeSec,
      allowedAlgorithms: dto.allowedAlgorithms,
      wantResponseSigned: dto.wantResponseSigned,
      wantAssertionsEncrypted: dto.wantAssertionsEncrypted,
      spDecryptionPrivateKey: dto.spDecryptionPrivateKey,
      spEncryptionCertificate: dto.spEncryptionCertificate,
      sloUrl: dto.sloUrl,
      logoutCallbackUrl: dto.logoutCallbackUrl,
      spSigningPrivateKey: dto.spSigningPrivateKey,
      spSigningCertificate: dto.spSigningCertificate,
      isActive: dto.isActive,
      allowedDomains: dto.allowedDomains,
      enforced: dto.enforced,
      jitEnabled: dto.jitEnabled,
      defaultRole: dto.defaultRole,
      discoveryUrl: dto.discoveryUrl,
      jwksUrl: dto.jwksUrl,
      scopes: dto.scopes,
      actorId: user.userId || user.id,
      actorIsPlatform: isPlatformPrincipal(req),
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Delete('sso/:providerType/config')
  @RequirePermissions(Permission.SSO_MANAGE, Permission.SECURITY_POLICY_WRITE)
  async disableSso(@Param('providerType') providerType: string, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const provider = providerType.toUpperCase() as SsoProvider;
    if (![SsoProvider.SAML, SsoProvider.OIDC].includes(provider)) {
      throw new BadRequestException(`Invalid provider type ${providerType}`);
    }
    return this.ssoService.disableSso({
      tenantId,
      providerType: provider,
      actorId: user.userId || user.id,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Get('sso/status')
  @RequirePermissions(Permission.SSO_READ, Permission.SECURITY_EVENT_READ)
  async getSsoStatus(@TenantId() tenantId: string) {
    return this.ssoService.getSsoStatus(tenantId);
  }

  @Get('sso/providers')
  @RequirePermissions(Permission.SSO_READ)
  async listSsoProviders(@TenantId() tenantId: string, @Query('tenantId') tenantIdQuery?: string, @CurrentUser() user?: any) {
    const effectiveTenantId = tenantIdQuery || tenantId;
    // Platform admin can query any tenant
    if (tenantIdQuery && tenantIdQuery !== tenantId) {
      // Cross-tenant reads are for platform staff holding platform:manage only.
      const perms: string[] = Array.isArray(user?.permissions) ? user.permissions : [];
      if (user?.isPlatformUser !== true || !perms.includes(Permission.PLATFORM_MANAGE)) {
        throw new ForbiddenException('Cross-tenant access denied');
      }
    }
    return this.ssoFactory.listTenantProviders(effectiveTenantId);
  }

  // SSO login itself is served by the public, rate-limited routes in
  // modules/auth/sso (POST /v1/auth/sso/start, /callback, /saml/acs).

  // ===== API Keys =====

  @Post('api-keys')
  @RequirePermissions(Permission.API_KEY_WRITE, Permission.API_KEY_MANAGE)
  async createApiKey(@Body() dto: CreateApiKeyDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const result = await this.apiKeyService.createApiKey({
      tenantId,
      userId: user.userId || user.id,
      name: dto.name,
      scopes: dto.scopes,
      ipAllowlist: dto.ipAllowlist,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdById: user.userId || user.id,
      callerPermissions: user.permissions || user.roles || [],
      idempotencyKey: dto.idempotencyKey,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });

    // Secret shown only once
    return {
      ...result.record,
      secret: result.secret,
      warning: 'Secret shown only once - store securely, it will never be shown again',
    };
  }

  @Get('api-keys')
  @RequirePermissions(Permission.API_KEY_READ, Permission.API_KEY_MANAGE)
  async listApiKeys(@Query() query: ListApiKeyDto, @TenantId() tenantId: string, @CurrentUser() user: any) {
    const caller = {
      userId: user.userId || user.id,
      tenantId: tenantId,
      permissions: user.permissions || user.roles || [],
    };
    return this.apiKeyService.listApiKeys(tenantId, caller, {
      userId: query.userId,
      state: query.state as any,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('api-keys/:id/rotate')
  @RequirePermissions(Permission.API_KEY_WRITE, Permission.API_KEY_MANAGE)
  async rotateApiKey(@Param('id') id: string, @Body() dto: RotateApiKeyDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const caller = {
      userId: user.userId || user.id,
      tenantId,
      permissions: user.permissions || user.roles || [],
    };
    const result = await this.apiKeyService.rotateApiKey({
      id,
      tenantId,
      caller,
      createdById: user.userId || user.id,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
      idempotencyKey: dto.idempotencyKey,
    });

    return {
      ...result.record,
      secret: result.secret,
      warning: 'New secret shown only once - old key rotated per policy',
    };
  }

  @Post('api-keys/:id/revoke')
  @RequirePermissions(Permission.API_KEY_WRITE, Permission.API_KEY_MANAGE)
  async revokeApiKey(@Param('id') id: string, @Body() dto: RevokeApiKeyDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const caller = {
      userId: user.userId || user.id,
      tenantId,
      permissions: user.permissions || user.roles || [],
    };
    return this.apiKeyService.revokeApiKey({
      id,
      tenantId,
      caller,
      reason: dto.reason,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  // ===== Sessions =====

  @Get('sessions')
  @RequirePermissions(Permission.SESSION_READ, Permission.SECURITY_EVENT_READ)
  async listSessions(@Query() query: SessionQueryDto, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const userId = query.userId || user.userId || user.id;
    const perms = user.permissions || user.roles || [];
    const isPrivileged = perms.includes('ADMIN') || perms.includes('OWNER') || perms.includes('PLATFORM_MANAGE');

    if (query.userId && query.userId !== (user.userId || user.id) && !isPrivileged) {
      throw new ForbiddenException('Cannot list other users sessions');
    }

    const sessions = await this.sessionService.listUserSessions(userId, tenantId, (req as any).sessionId || null);
    return { data: sessions, total: sessions.length };
  }

  @Post('sessions/:sessionId/revoke')
  @RequirePermissions(Permission.SESSION_WRITE)
  async revokeSession(@Param('sessionId') sessionId: string, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const userId = user.userId || user.id;
    // Users can revoke own sessions, admins can revoke any in tenant
    return this.sessionService.revokeSession({
      sessionId,
      userId,
      tenantId,
      reason: 'user_revoked',
      actorId: userId,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Post('sessions/revoke-all')
  @RequirePermissions(Permission.SESSION_WRITE)
  async revokeAllSessions(@Body() body: { exceptCurrent?: boolean }, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    const userId = user.userId || user.id;
    const exceptSessionId = body.exceptCurrent ? (req as any).sessionId || null : null;
    const count = await this.sessionService.revokeAllSessions({
      userId,
      tenantId,
      exceptSessionId,
      reason: 'global_logout',
      actorId: userId,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
    return { revoked: count };
  }

  // ===== Devices =====

  @Get('devices')
  @RequirePermissions(Permission.DEVICE_READ, Permission.SECURITY_EVENT_READ)
  async listDevices(@Query() query: DeviceQueryDto, @TenantId() tenantId: string, @CurrentUser() user: any) {
    const userId = query.userId || user.userId || user.id;
    const perms = user.permissions || user.roles || [];
    const isPrivileged = perms.includes('ADMIN') || perms.includes('OWNER') || perms.includes('PLATFORM_MANAGE');

    if (query.userId && query.userId !== (user.userId || user.id) && !isPrivileged) {
      throw new ForbiddenException('Cannot list other users devices');
    }

    return this.deviceService.listDevices(tenantId, userId, { state: query.state as any, page: query.page, limit: query.limit });
  }

  @Post('devices/register')
  @RequirePermissions(Permission.DEVICE_WRITE)
  async registerDevice(@Body() body: { deviceId: string; userAgent?: string }, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.deviceService.registerDevice({
      tenantId,
      userId: user.userId || user.id,
      deviceId: body.deviceId,
      userAgent: body.userAgent || req.headers['user-agent'],
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Post('devices/:deviceId/trust')
  @RequirePermissions(Permission.DEVICE_WRITE, Permission.SECURITY_POLICY_WRITE)
  async trustDevice(@Param('deviceId') deviceId: string, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.deviceService.trustDevice({
      tenantId,
      userId: user.userId || user.id,
      deviceId,
      actorId: user.userId || user.id,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Post('devices/:deviceId/revoke')
  @RequirePermissions(Permission.DEVICE_WRITE)
  async revokeDevice(@Param('deviceId') deviceId: string, @Body() body: { reason?: string }, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.deviceService.revokeDevice({
      tenantId,
      userId: user.userId || user.id,
      deviceId,
      actorId: user.userId || user.id,
      reason: body.reason,
      ipHash: this.ipHashOf(req),
      requestId: req.headers['x-request-id'],
    });
  }

  @Get('devices/trust/evaluate')
  @RequirePermissions(Permission.DEVICE_READ)
  async evaluateDeviceTrust(@Query('deviceId') deviceId: string, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    if (!deviceId) throw new BadRequestException('deviceId required');
    return this.deviceService.evaluateDeviceTrust({
      tenantId,
      userId: user.userId || user.id,
      deviceId,
      userAgent: req.headers['user-agent'],
      ipHash: this.ipHashOf(req),
    });
  }

  // ===== MFA Policy =====

  @Get('mfa/required')
  @RequirePermissions(Permission.MFA_READ, Permission.SECURITY_EVENT_READ)
  async isMfaRequired(@Query('operation') operation: string, @Query('deviceId') deviceId: string, @TenantId() tenantId: string, @CurrentUser() user: any, @Req() req: any) {
    return this.mfaPolicyService.isMfaRequired({
      tenantId,
      userId: user.userId || user.id,
      roles: user.permissions || user.roles || [],
      operation,
      deviceId,
      ipHash: this.ipHashOf(req),
      userAgent: req.headers['user-agent'],
    });
  }

  // ===== Security Events =====

  @Get('events')
  @RequirePermissions(Permission.SECURITY_EVENT_READ, Permission.PLATFORM_MANAGE)
  async listSecurityEvents(@Query() query: SecurityEventQueryDto, @TenantId() tenantId: string, @CurrentUser() user: any) {
    // Tenant isolation - platform admin can query any tenant via query param? For now tenantId from context
    const effectiveTenantId = (query as any).tenantId || tenantId;
    if ((query as any).tenantId && (query as any).tenantId !== tenantId) {
      const perms = user.permissions || user.roles || [];
      if (!perms.includes('PLATFORM_MANAGE')) {
        throw new ForbiddenException('Cross-tenant access denied');
      }
    }

    return this.eventService.listEvents(effectiveTenantId, {
      userId: query.userId,
      type: query.type,
      severity: query.severity,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('audit')
  @RequirePermissions(Permission.SECURITY_EVENT_READ, Permission.PLATFORM_MANAGE)
  async listAuditLogs(@Query() query: SecurityEventQueryDto, @TenantId() tenantId: string, @CurrentUser() user: any) {
    const effectiveTenantId = (query as any).tenantId || tenantId;
    if ((query as any).tenantId && (query as any).tenantId !== tenantId) {
      const perms = user.permissions || user.roles || [];
      if (!perms.includes('PLATFORM_MANAGE')) {
        throw new ForbiddenException('Cross-tenant access denied');
      }
    }

    return this.auditService.listAuditLogs(effectiveTenantId, {
      userId: query.userId,
      event: query.type,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  // ===== Threat Detection =====

  @Get('threats')
  @RequirePermissions(Permission.SECURITY_EVENT_READ, Permission.PLATFORM_MANAGE)
  async listThreats(@Query() query: ThreatQueryDto, @TenantId() tenantId: string, @CurrentUser() user: any) {
    const effectiveTenantId = (query as any).tenantId || tenantId;
    if ((query as any).tenantId && (query as any).tenantId !== tenantId) {
      const perms = user.permissions || user.roles || [];
      if (!perms.includes('PLATFORM_MANAGE')) {
        throw new ForbiddenException('Cross-tenant access denied');
      }
    }

    return this.threatService.listThreats(effectiveTenantId, {
      userId: query.userId,
      riskLevel: query.riskLevel as any,
      ruleId: query.ruleId,
      resolved: query.resolved ? query.resolved === 'true' : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('threats/detect')
  @RequirePermissions(Permission.PLATFORM_MANAGE, Permission.SECURITY_EVENT_READ)
  async detectThreats(@Body() body: { tenantId?: string; userId?: string; fromDate?: string; toDate?: string }, @TenantId() tenantId: string) {
    const effectiveTenantId = body.tenantId || tenantId;
    return this.threatService.detectThreats({
      tenantId: effectiveTenantId,
      userId: body.userId,
      fromDate: body.fromDate ? new Date(body.fromDate) : undefined,
      toDate: body.toDate ? new Date(body.toDate) : undefined,
    });
  }

  @Post('threats/:id/resolve')
  @RequirePermissions(Permission.SECURITY_EVENT_WRITE, Permission.PLATFORM_MANAGE)
  async resolveThreat(@Param('id') id: string, @Body() body: { resolution: string }, @TenantId() tenantId: string, @CurrentUser() user: any) {
    return this.threatService.resolveThreat(id, tenantId, user.userId || user.id, body.resolution);
  }

  // Preserve old security events endpoints for backward compatibility

  @Get('events/legacy')
  @RequirePermissions(Permission.SECURITY_EVENT_READ)
  async listLegacyEvents(@Query() query: any, @TenantId() tenantId: string) {
    return this.eventService.listEvents(tenantId, {
      userId: query.userId,
      type: query.type,
      severity: query.severity,
      page: query.page,
      limit: query.limit,
    });
  }
}

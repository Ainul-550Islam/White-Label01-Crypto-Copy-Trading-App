import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiKeyRepository } from './api-key.repository';
import { SecurityPolicyService } from './security-policy.service';
import { SecurityEventService } from './security-event.service';
import { SecurityAuditService } from './security-audit.service';
import { ApiKeyState, SecurityEventType, SecurityRisk } from './security.types';
import { randomUUID, randomBytes, createHash, createHmac } from 'crypto';

/**
 * Secure API key management: creation, hashing/fingerprinting, scoped permissions, expiration, rotation, revocation, tenant/user ownership using existing RBAC permissions.
 * Secret shown only at creation, persist hash/fingerprint not raw secret, cryptographically secure random generation.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly secretKey: string;

  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly policyService: SecurityPolicyService,
    private readonly eventService: SecurityEventService,
    private readonly auditService: SecurityAuditService,
  ) {
    this.secretKey = process.env.API_KEY_HMAC_SECRET || process.env.API_KEY_SECRET || 'dev_api_key_hmac_secret_change_in_production';
  }

  async createApiKey(params: {
    tenantId: string;
    userId: string;
    name: string;
    scopes: string[];
    ipAllowlist?: string[];
    expiresAt?: Date;
    createdById: string;
    callerPermissions: string[];
    idempotencyKey?: string;
    ipHash?: string;
    requestId?: string;
  }): Promise<{ record: any; secret: string }> {
    // Validate scopes cannot exceed caller permissions
    const forbiddenScopes = params.scopes.filter((scope) => !this.isScopeAllowed(scope, params.callerPermissions));
    if (forbiddenScopes.length > 0) {
      throw new ForbiddenException(`Scopes exceed caller permissions: ${forbiddenScopes.join(', ')} - cannot assign unrestricted platform permissions`);
    }

    // Prevent PLATFORM_MANAGE unless caller has it
    if (params.scopes.includes('PLATFORM_MANAGE') && !params.callerPermissions.includes('PLATFORM_MANAGE')) {
      throw new ForbiddenException('Cannot assign PLATFORM_MANAGE without having it');
    }

    // Validate tenant ownership
    if (!params.tenantId) {
      throw new BadRequestException('tenantId required');
    }

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });

    // Determine expiration per policy if not provided
    let expiresAt = params.expiresAt;
    if (!expiresAt) {
      const expiryDays = policy.apiKeyExpirationDays || 90;
      expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    } else {
      // Check if expiration exceeds policy max
      const maxExpiry = new Date(Date.now() + (policy.apiKeyExpirationDays || 90) * 24 * 60 * 60 * 1000);
      if (expiresAt > maxExpiry) {
        throw new BadRequestException(`Expiration exceeds policy maximum of ${policy.apiKeyExpirationDays} days`);
      }
    }

    // Generate cryptographically secure random secret
    const keyId = `ak_${randomBytes(8).toString('hex')}`;
    const secretPart = randomBytes(32).toString('base64url');
    const fullSecret = `${keyId}.${secretPart}`;

    // Hash and fingerprint - never store raw secret
    const secretHash = this.hashSecret(fullSecret);
    const fingerprint = this.createFingerprint(fullSecret);

    const record = await this.repository.create({
      tenantId: params.tenantId,
      userId: params.userId,
      name: params.name,
      keyId,
      secretHash,
      fingerprint,
      scopes: params.scopes,
      ipAllowlist: params.ipAllowlist || [],
      expiresAt,
      createdById: params.createdById,
      idempotencyKey: params.idempotencyKey,
    });

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      type: SecurityEventType.API_KEY_CREATED,
      severity: SecurityRisk.MEDIUM,
      description: `API key created name=${params.name} keyId=${keyId}`,
      safeMetadata: { keyId, name: params.name, scopes: params.scopes, expiresAt: expiresAt?.toISOString() },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.createdById,
      event: 'API_KEY_CREATED',
      result: 'SUCCESS',
      targetType: 'ApiKey',
      targetId: record.id,
      safeMetadata: { keyId, name: params.name, scopes: params.scopes },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    this.logger.log(`API key created tenant=${params.tenantId} user=${params.userId} keyId=${keyId} - secret shown only once`);

    // Return secret ONLY at creation - never again
    return {
      record: {
        id: record.id,
        tenantId: record.tenantId,
        userId: record.userId,
        name: record.name,
        keyId: record.keyId,
        fingerprint: record.fingerprint,
        scopes: record.scopes,
        state: record.state,
        expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : undefined,
        createdAt: new Date(record.createdAt).toISOString(),
      },
      secret: fullSecret,
    };
  }

  async listApiKeys(tenantId: string, caller: { userId: string; tenantId: string; permissions: string[] }, filters?: { userId?: string; state?: ApiKeyState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    // Tenant isolation
    if (caller.tenantId !== tenantId && !caller.permissions.includes('PLATFORM_MANAGE')) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    // Ordinary users can only list own keys unless admin
    const isPrivileged = caller.permissions.includes('ADMIN') || caller.permissions.includes('OWNER') || caller.permissions.includes('API_KEY_MANAGE') || caller.permissions.includes('PLATFORM_MANAGE');

    let effectiveUserId = filters?.userId;
    if (!isPrivileged) {
      effectiveUserId = caller.userId;
    }

    const result = await this.repository.listByTenant(tenantId, {
      userId: effectiveUserId,
      state: filters?.state as any,
      page: filters?.page,
      limit: filters?.limit,
    });

    // Never return secretHash
    const sanitized = result.data.map((k: any) => ({
      id: k.id,
      tenantId: k.tenantId,
      userId: k.userId,
      name: k.name,
      keyId: k.keyId,
      fingerprint: k.fingerprint,
      scopes: k.scopes,
      state: k.state,
      ipAllowlist: k.ipAllowlist,
      expiresAt: k.expiresAt ? new Date(k.expiresAt).toISOString() : null,
      lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toISOString() : null,
      revokedAt: k.revokedAt ? new Date(k.revokedAt).toISOString() : null,
      rotatedAt: k.rotatedAt ? new Date(k.rotatedAt).toISOString() : null,
      createdAt: k.createdAt ? new Date(k.createdAt).toISOString() : null,
      updatedAt: k.updatedAt ? new Date(k.updatedAt).toISOString() : null,
    }));

    return { data: sanitized, total: result.total };
  }

  async validateApiKey(fullSecret: string, ip?: string): Promise<{ valid: boolean; record?: any; reason?: string }> {
    // Extract keyId and secret part
    const parts = fullSecret.split('.');
    if (parts.length !== 2) {
      return { valid: false, reason: 'INVALID_FORMAT' };
    }

    const keyId = parts[0];
    const fingerprint = this.createFingerprint(fullSecret);

    const record = await this.repository.findByKeyId(keyId);
    if (!record) {
      // Try fingerprint lookup
      const byFingerprint = await this.repository.findByFingerprint(fingerprint);
      if (!byFingerprint) {
        return { valid: false, reason: 'KEY_NOT_FOUND' };
      }
      return this.validateRecord(byFingerprint, fullSecret, ip, fingerprint);
    }

    return this.validateRecord(record, fullSecret, ip, fingerprint);
  }

  private async validateRecord(record: any, fullSecret: string, ip?: string, fingerprint?: string): Promise<{ valid: boolean; record?: any; reason?: string }> {
    // Check state
    if (record.state === 'REVOKED' || record.revokedAt) {
      return { valid: false, reason: 'REVOKED' };
    }
    if (record.state === 'EXPIRED') {
      return { valid: false, reason: 'EXPIRED' };
    }
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return { valid: false, reason: 'EXPIRED' };
    }
    if (record.state === 'ROTATED') {
      return { valid: false, reason: 'ROTATED' };
    }

    // Validate hash
    const secretHash = this.hashSecret(fullSecret);
    if (record.secretHash !== secretHash) {
      // Also try to validate fingerprint match if secretHash is from old TenantApiKey (HMAC vs hash)
      if (fingerprint && record.fingerprint !== fingerprint && record.keyId) {
        // For TenantApiKey, fingerprint is keyId, check HMAC
        const hmacHash = createHmac('sha256', this.secretKey).update(fullSecret).digest('hex').substring(0, 128);
        if (record.secretHash !== hmacHash && record.secretHash !== secretHash) {
          return { valid: false, reason: 'INVALID_SECRET' };
        }
      } else if (record.secretHash !== secretHash) {
        return { valid: false, reason: 'INVALID_SECRET' };
      }
    }

    // IP allowlist check
    if (record.ipAllowlist && record.ipAllowlist.length > 0 && ip) {
      if (!record.ipAllowlist.includes(ip)) {
        return { valid: false, reason: 'IP_NOT_ALLOWED' };
      }
    }

    // Update last used
    try {
      await this.repository.updateLastUsed(record.id, record.tenantId);
    } catch {}

    return { valid: true, record };
  }

  async rotateApiKey(params: {
    id: string;
    tenantId: string;
    caller: { userId: string; tenantId: string; permissions: string[] };
    createdById: string;
    ipHash?: string;
    requestId?: string;
    idempotencyKey?: string;
  }): Promise<{ record: any; secret: string }> {
    const existing = await this.repository.findById(params.id, params.tenantId);
    if (!existing) {
      throw new NotFoundException(`API key ${params.id} not found`);
    }

    // Check ownership
    const isOwner = existing.userId === params.caller.userId;
    const isPrivileged = params.caller.permissions.includes('ADMIN') || params.caller.permissions.includes('OWNER') || params.caller.permissions.includes('API_KEY_MANAGE') || params.caller.permissions.includes('PLATFORM_MANAGE');

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('Cannot rotate API key owned by another user');
    }

    if (existing.tenantId !== params.tenantId && !params.caller.permissions.includes('PLATFORM_MANAGE')) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    // Check if already revoked/expired
    if (existing.state === 'REVOKED' || existing.revokedAt) {
      throw new BadRequestException('Cannot rotate revoked key');
    }

    const policy = await this.policyService.getEffectivePolicy({ tenantId: params.tenantId });
    const expiresAt = new Date(Date.now() + (policy.apiKeyExpirationDays || 90) * 24 * 60 * 60 * 1000);

    const keyId = `ak_${randomBytes(8).toString('hex')}`;
    const secretPart = randomBytes(32).toString('base64url');
    const fullSecret = `${keyId}.${secretPart}`;
    const secretHash = this.hashSecret(fullSecret);
    const fingerprint = this.createFingerprint(fullSecret);

    const newRecordData = {
      tenantId: existing.tenantId,
      userId: existing.userId,
      name: existing.name,
      keyId,
      secretHash,
      fingerprint,
      scopes: existing.scopes,
      ipAllowlist: existing.ipAllowlist || [],
      expiresAt,
      createdById: params.createdById,
      idempotencyKey: params.idempotencyKey,
      rotatedFromId: existing.id,
    };

    const newRecord = await this.repository.rotate(existing.id, newRecordData);

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: existing.userId,
      type: SecurityEventType.API_KEY_ROTATED,
      severity: SecurityRisk.MEDIUM,
      description: `API key rotated oldKeyId=${existing.keyId} newKeyId=${keyId}`,
      safeMetadata: { oldKeyId: existing.keyId, newKeyId: keyId, name: existing.name },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      userId: existing.userId,
      actorId: params.createdById,
      event: 'API_KEY_ROTATED',
      result: 'SUCCESS',
      targetType: 'ApiKey',
      targetId: newRecord.id,
      safeMetadata: { oldKeyId: existing.keyId, newKeyId: keyId },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    this.logger.log(`API key rotated tenant=${params.tenantId} oldKeyId=${existing.keyId} newKeyId=${keyId} - new secret shown only once`);

    return {
      record: {
        id: newRecord.id,
        tenantId: newRecord.tenantId,
        userId: newRecord.userId,
        name: newRecord.name,
        keyId: newRecord.keyId,
        fingerprint: newRecord.fingerprint,
        scopes: newRecord.scopes,
        state: newRecord.state,
        expiresAt: newRecord.expiresAt ? new Date(newRecord.expiresAt).toISOString() : undefined,
        createdAt: new Date(newRecord.createdAt).toISOString(),
      },
      secret: fullSecret,
    };
  }

  async revokeApiKey(params: { id: string; tenantId: string; caller: { userId: string; tenantId: string; permissions: string[] }; reason?: string; ipHash?: string; requestId?: string }): Promise<any> {
    const existing = await this.repository.findById(params.id, params.tenantId);
    if (!existing) {
      throw new NotFoundException(`API key ${params.id} not found`);
    }

    const isOwner = existing.userId === params.caller.userId;
    const isPrivileged = params.caller.permissions.includes('ADMIN') || params.caller.permissions.includes('OWNER') || params.caller.permissions.includes('API_KEY_MANAGE') || params.caller.permissions.includes('PLATFORM_MANAGE');

    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('Cannot revoke API key owned by another user');
    }

    if (existing.tenantId !== params.tenantId && !params.caller.permissions.includes('PLATFORM_MANAGE')) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    const revoked = await this.repository.revoke(params.id, params.tenantId, params.reason);

    await this.eventService.record({
      tenantId: params.tenantId,
      userId: existing.userId,
      type: SecurityEventType.API_KEY_REVOKED,
      severity: SecurityRisk.MEDIUM,
      description: `API key revoked keyId=${existing.keyId} reason=${params.reason || 'manual'}`,
      safeMetadata: { keyId: existing.keyId, name: existing.name, reason: params.reason },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    await this.auditService.record({
      tenantId: params.tenantId,
      userId: existing.userId,
      actorId: params.caller.userId,
      event: 'API_KEY_REVOKED',
      result: 'SUCCESS',
      targetType: 'ApiKey',
      targetId: existing.id,
      safeMetadata: { keyId: existing.keyId, reason: params.reason },
      ipHash: params.ipHash,
      requestId: params.requestId,
    });

    return { id: revoked?.id || existing.id, state: 'REVOKED', revokedAt: new Date().toISOString() };
  }

  private hashSecret(secret: string): string {
    return createHmac('sha256', this.secretKey).update(secret).digest('hex');
  }

  private createFingerprint(secret: string): string {
    return createHash('sha256').update(secret).digest('hex').substring(0, 64);
  }

  private isScopeAllowed(scope: string, callerPermissions: string[]): boolean {
    // If caller has PLATFORM_MANAGE, allow all
    if (callerPermissions.includes('PLATFORM_MANAGE')) return true;

    // If caller has ADMIN/OWNER, allow tenant scopes but not platform-only
    const platformOnlyScopes = ['PLATFORM_MANAGE', 'TENANT_MANAGE', 'BILLING_ADMIN'];
    if (platformOnlyScopes.includes(scope)) {
      return callerPermissions.includes(scope);
    }

    // Regular scopes must be subset of caller permissions or caller has wildcard
    if (callerPermissions.includes(scope)) return true;
    if (callerPermissions.includes('API_KEY_MANAGE')) return true;
    if (callerPermissions.includes('ADMIN') || callerPermissions.includes('OWNER')) return true;

    return false;
  }
}

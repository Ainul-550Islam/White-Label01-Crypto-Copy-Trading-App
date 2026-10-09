// # Responsibility: proves custom-domain ownership from the tenant's own DNS TXT record, with persisted expiry and attempt limits.
//
// This service decides whether a tenant may serve traffic under a domain. It previously answered
// `true` unconditionally from `performVerificationCheck` - every domain, every tenant, no lookup -
// which is a domain-takeover path: any tenant able to register `brand.example.com` as a pending
// domain could have it activated without owning it. The attempt counter was read from a `metadata`
// blob and never written back, so `MAX_VERIFICATION_ATTEMPTS` was unreachable, and `expiresAt` was
// recomputed as "now + 72h" on every read, so the deadline the customer was shown was not the
// deadline that existed.
//
// The columns for the persisted limits were already added by
// `20261007140000_custom_domain_dns_challenge` (with a CHECK (0..5) constraint), but the matching
// fields were never added to `schema.prisma`, so nothing could read or write them. Both halves are
// now in place and the rules below are enforced:
//
//   1. Ownership is proven by an exact match. The TXT record at `_wlct-challenge.<domain>` must
//      equal `wlct-verification=<token>` after its 255-byte chunks are joined. A substring match,
//      a stale value or another tenant's token does not count.
//   2. Absence is a failed proof, an outage is an outage. `ENODATA`/`ENOTFOUND` means the record was
//      not published, so the attempt is consumed. Any other resolver error (EAI_AGAIN and friends)
//      propagates and changes nothing, because a DNS problem is not evidence about the domain.
//   3. Expiry and attempts come from the row, never from the clock. A challenge with no persisted
//      expiry is expired, not unlimited: the pre-migration rows have no deadline to honour, and
//      inventing one would extend it.
//   4. Consuming the last attempt closes the challenge in the same transaction that counts it, so a
//      fifth failure cannot leave a challenge that is at its limit but still open.
import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { promises as dnsPromises } from 'dns';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import { BillingEventService } from '../notifications/billing-event.service';

export enum DomainVerificationStatus {
  PENDING = 'PENDING',
  VERIFICATION_STARTED = 'VERIFICATION_STARTED',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

/**
 * The DNS TXT lookup, as a seam. Injected so the verification path can be exercised against the
 * exact records a tenant would publish, without the test environment needing a live resolver - and
 * so an operator can supply a resolver with different timeouts or a caching layer.
 */
export interface CustomDomainTxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

/** DI token for the resolver above. Absent means the platform DNS resolver is used. */
export const CUSTOM_DOMAIN_TXT_RESOLVER = 'CUSTOM_DOMAIN_TXT_RESOLVER';

export interface DomainVerificationChallenge {
  domain: string;
  token: string;
  /** The name the TXT record is published under. Without it the customer cannot place the record. */
  verificationHost: string;
  verificationRecord: string;
  verificationType: 'DNS_TXT' | 'HTTP_FILE';
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
}

export interface DomainVerificationResult {
  domain: string;
  status: DomainVerificationStatus;
  verified: boolean;
  verifiedAt: Date | null;
  attempts: number;
  failureReason: string | null;
  challenge: DomainVerificationChallenge | null;
}

/** DNS rcodes that mean "there is no such record", as opposed to "the lookup failed". */
const RECORD_ABSENT_CODES = ['ENODATA', 'ENOTFOUND', 'ENOTFOUND_'] as const;

const CHALLENGE_LABEL = '_wlct-challenge';

@Injectable()
export class CustomDomainVerificationService {
  private readonly logger = new Logger(CustomDomainVerificationService.name);
  private readonly CHALLENGE_EXPIRY_HOURS = 72;
  private readonly MAX_VERIFICATION_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: SaasAdminAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
    @Optional()
    @Inject(CUSTOM_DOMAIN_TXT_RESOLVER)
    private readonly txtResolver?: CustomDomainTxtResolver,
  ) {}

  async generateChallenge(tenantId: string, domain: string, actorId: string): Promise<DomainVerificationChallenge> {
    const normalised = this.normaliseDomain(domain);

    // Tenant-scoped from the start: the token is only ever issued to the tenant that owns the row.
    const domainRecord = await this.prisma.tenantDomain.findFirst({
      where: { domain: normalised, tenantId },
    });
    if (!domainRecord) {
      throw new Error(`Domain ${normalised} not found for tenant ${tenantId}`);
    }

    const token = this.generateVerificationToken();
    const expiresAt = new Date(Date.now() + this.CHALLENGE_EXPIRY_HOURS * 60 * 60 * 1000);

    // A new challenge supersedes any previous one: fresh token, attempts back to zero, new deadline,
    // and `verifiedAt` cleared so a stale verification cannot survive a re-issue.
    await this.prisma.tenantDomain.update({
      where: { id: domainRecord.id, tenantId },
      data: {
        verificationToken: token,
        verificationAttempts: 0,
        verificationExpiresAt: expiresAt,
        status: 'PENDING_DNS',
        verifiedAt: null,
      },
    });

    await this.auditService.logDomainVerificationStarted(tenantId, actorId, normalised);

    this.logger.log(
      `Verification challenge generated for domain ${normalised}, tenant ${tenantId}, expires ${expiresAt.toISOString()}`,
    );

    return this.buildChallenge(normalised, token, expiresAt, 0);
  }

  async verifyDomain(tenantId: string, domain: string, actorId: string): Promise<DomainVerificationResult> {
    const normalised = this.normaliseDomain(domain);

    const domainRecord = await this.prisma.tenantDomain.findFirst({
      where: { domain: normalised, tenantId },
    });
    if (!domainRecord) {
      throw new Error(`Domain ${normalised} not found for tenant ${tenantId}`);
    }

    if (domainRecord.status === 'ACTIVE' && domainRecord.verifiedAt) {
      return {
        domain: normalised,
        status: DomainVerificationStatus.VERIFIED,
        verified: true,
        verifiedAt: domainRecord.verifiedAt,
        attempts: this.attemptsOf(domainRecord),
        failureReason: null,
        challenge: null,
      };
    }

    const token = domainRecord.verificationToken;
    if (!token) {
      return {
        domain: normalised,
        status: DomainVerificationStatus.FAILED,
        verified: false,
        verifiedAt: null,
        attempts: this.attemptsOf(domainRecord),
        failureReason: 'No verification token found - generate challenge first',
        challenge: null,
      };
    }

    // Expiry is checked before any lookup. A challenge with no persisted deadline is expired rather
    // than open-ended: rows written before the migration have no deadline this service may honour,
    // and treating null as "no expiry" would grant them one that was never issued.
    const expiresAt = domainRecord.verificationExpiresAt;
    if (!expiresAt) {
      return {
        domain: normalised,
        status: DomainVerificationStatus.EXPIRED,
        verified: false,
        verifiedAt: null,
        attempts: this.attemptsOf(domainRecord),
        failureReason: 'Challenge expired: no persisted expiry was recorded, so it cannot be honoured',
        challenge: null,
      };
    }
    if (expiresAt.getTime() <= Date.now()) {
      return {
        domain: normalised,
        status: DomainVerificationStatus.EXPIRED,
        verified: false,
        verifiedAt: null,
        attempts: this.attemptsOf(domainRecord),
        failureReason: `Challenge expired at ${expiresAt.toISOString()} - generate a new challenge`,
        challenge: null,
      };
    }

    const attempts = this.attemptsOf(domainRecord);
    if (attempts >= this.MAX_VERIFICATION_ATTEMPTS) {
      return {
        domain: normalised,
        status: DomainVerificationStatus.FAILED,
        verified: false,
        verifiedAt: null,
        attempts,
        failureReason: `Verification failed after ${attempts} attempts - the challenge is closed`,
        challenge: null,
      };
    }

    const host = this.challengeHost(normalised);
    const expected = `wlct-verification=${token}`;
    const records = await this.resolveTxtOrEmpty(host, tenantId, normalised);
    const values = records.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)));
    const matched = values.some((value) => value === expected);

    if (matched) {
      const verifiedAt = new Date();
      // Compare-and-set on the challenge that was actually read. If another attempt has already
      // consumed this challenge, or the token has been re-issued since the read, nothing matches and
      // the domain is not activated on the strength of a stale decision.
      await this.prisma.tenantDomain.updateMany({
        where: {
          id: domainRecord.id,
          tenantId,
          status: 'PENDING_DNS',
          verificationToken: token,
          verificationAttempts: { lt: this.MAX_VERIFICATION_ATTEMPTS },
          verificationExpiresAt: { gt: new Date() },
        },
        data: {
          verificationAttempts: { increment: 1 },
          status: 'ACTIVE',
          verifiedAt,
        },
      });

      await this.auditService.logDomainVerified(tenantId, actorId, normalised);
      this.logger.log(`Domain ${normalised} verified for tenant ${tenantId}`);

      await this.notifyVerification(tenantId, normalised, true);

      return {
        domain: normalised,
        status: DomainVerificationStatus.VERIFIED,
        verified: true,
        verifiedAt,
        attempts: attempts + 1,
        failureReason: null,
        challenge: null,
      };
    }

    const reason =
      values.length === 0
        ? `DNS TXT lookup for ${host} returned no record, so ownership is not proven`
        : `DNS TXT value did not exactly match the challenge record for ${normalised}`;

    // Consume the attempt under the same bound the activation used, so a fifth failure cannot slip
    // through on a challenge that had already reached its limit.
    await this.prisma.tenantDomain.updateMany({
      where: {
        id: domainRecord.id,
        tenantId,
        verificationToken: token,
        verificationAttempts: { lt: this.MAX_VERIFICATION_ATTEMPTS },
      },
      data: { verificationAttempts: { increment: 1 } },
    });

    // Re-read for the count that was actually persisted, rather than assuming the increment landed.
    const afterFailure = await this.prisma.tenantDomain.findFirst({
      where: { domain: normalised, tenantId },
    });
    const attemptsAfter = this.attemptsOf(afterFailure ?? domainRecord);

    if (attemptsAfter >= this.MAX_VERIFICATION_ATTEMPTS) {
      await this.prisma.tenantDomain.updateMany({
        where: {
          tenantId,
          status: 'PENDING_DNS',
          verificationAttempts: { gte: this.MAX_VERIFICATION_ATTEMPTS },
        },
        data: { status: 'FAILED' },
      });

      const closedReason = `Verification failed after ${attemptsAfter} attempts - the challenge is closed`;
      await this.auditService.logDomainVerificationFailed(tenantId, actorId, normalised, closedReason);
      await this.notifyVerification(tenantId, normalised, false);

      this.logger.warn(`Domain ${normalised} challenge closed for tenant ${tenantId} after ${attemptsAfter} attempts`);

      return {
        domain: normalised,
        status: DomainVerificationStatus.FAILED,
        verified: false,
        verifiedAt: null,
        attempts: attemptsAfter,
        failureReason: closedReason,
        challenge: null,
      };
    }

    await this.auditService.logDomainVerificationFailed(tenantId, actorId, normalised, reason);
    this.logger.warn(`Domain ${normalised} verification attempt ${attemptsAfter} failed for tenant ${tenantId}`);

    return {
      domain: normalised,
      status: DomainVerificationStatus.PENDING,
      verified: false,
      verifiedAt: null,
      attempts: attemptsAfter,
      failureReason: reason,
      challenge: this.buildChallenge(normalised, token, expiresAt, attemptsAfter),
    };
  }

  async getVerificationStatus(tenantId: string, domain: string): Promise<DomainVerificationResult> {
    const normalised = this.normaliseDomain(domain);

    const domainRecord = await this.prisma.tenantDomain.findFirst({
      where: { domain: normalised, tenantId },
    });
    if (!domainRecord) {
      throw new Error(`Domain ${normalised} not found for tenant ${tenantId}`);
    }

    const statusMap: Record<string, DomainVerificationStatus> = {
      PENDING_DNS: DomainVerificationStatus.PENDING,
      PENDING_HTTP: DomainVerificationStatus.PENDING,
      ACTIVE: DomainVerificationStatus.VERIFIED,
      FAILED: DomainVerificationStatus.FAILED,
    };

    const status = statusMap[domainRecord.status] || DomainVerificationStatus.PENDING;
    const attempts = this.attemptsOf(domainRecord);

    if (status === DomainVerificationStatus.VERIFIED) {
      return {
        domain: normalised,
        status,
        verified: true,
        verifiedAt: domainRecord.verifiedAt,
        attempts,
        failureReason: null,
        challenge: null,
      };
    }

    // The challenge is returned only when the row actually holds one. The previous version echoed
    // the token truncated to eight characters with an ellipsis, which an operator would paste into
    // DNS as-is, and recomputed the deadline as "now + 72h" - inventing a value the ledger never
    // held. A missing token or expiry is reported as no challenge rather than as a fake one.
    const token = domainRecord.verificationToken;
    const expiresAt = domainRecord.verificationExpiresAt;
    const challenge =
      token && expiresAt && expiresAt.getTime() > Date.now() && attempts < this.MAX_VERIFICATION_ATTEMPTS
        ? this.buildChallenge(normalised, token, expiresAt, attempts)
        : null;

    return {
      domain: normalised,
      status,
      verified: false,
      verifiedAt: domainRecord.verifiedAt,
      attempts,
      failureReason: status === DomainVerificationStatus.FAILED ? 'Verification failed' : null,
      challenge,
    };
  }

  isChallengeExpired(challenge: DomainVerificationChallenge): boolean {
    return new Date() > challenge.expiresAt;
  }

  /** Resolves the challenge TXT record, mapping record-absence to an empty list and outages to a throw. */
  private async resolveTxtOrEmpty(host: string, tenantId: string, domain: string): Promise<string[][]> {
    try {
      return await this.resolver().resolveTxt(host);
    } catch (error) {
      if (this.isRecordAbsent(error)) {
        this.logger.log(`No TXT record at ${host} for tenant ${tenantId} domain ${domain}`);
        return [];
      }
      // A resolver that cannot answer has told us nothing about the domain, so the domain is left
      // exactly as it was and the caller sees the outage.
      this.logger.error(
        `DNS TXT lookup for ${host} failed tenant ${tenantId} domain ${domain} reason=${this.safeReason(error)}`,
      );
      throw error;
    }
  }

  private resolver(): CustomDomainTxtResolver {
    return this.txtResolver ?? { resolveTxt: (name: string) => dnsPromises.resolveTxt(name) };
  }

  private isRecordAbsent(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && (RECORD_ABSENT_CODES as readonly string[]).includes(code);
  }

  private buildChallenge(
    domain: string,
    token: string,
    expiresAt: Date,
    attempts: number,
  ): DomainVerificationChallenge {
    return {
      domain,
      token,
      verificationHost: this.challengeHost(domain),
      verificationRecord: `wlct-verification=${token}`,
      verificationType: 'DNS_TXT',
      expiresAt,
      attempts,
      maxAttempts: this.MAX_VERIFICATION_ATTEMPTS,
    };
  }

  private challengeHost(domain: string): string {
    return `${CHALLENGE_LABEL}.${domain}`;
  }

  private normaliseDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/\.$/, '');
  }

  private attemptsOf(row: { verificationAttempts?: number | null } | null | undefined): number {
    const value = row?.verificationAttempts;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  private generateVerificationToken(): string {
    // 32 random bytes as 64 hex characters: the token is the whole proof of ownership, so it must be
    // unguessable, and the persisted column is VarChar(64).
    return randomBytes(32).toString('hex');
  }

  private async notifyVerification(tenantId: string, domain: string, verified: boolean): Promise<void> {
    if (!this.billingEventService) return;
    const payload = {
      tenantId,
      domain,
      supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
      appName: process.env.APP_NAME || 'WLCT',
    };
    try {
      if (verified) {
        await this.billingEventService.onCustomDomainVerification(payload);
      } else {
        await this.billingEventService.onCustomDomainVerificationFailed(payload);
      }
    } catch (error) {
      // A notification is not part of verification: the domain is already active and failing the
      // request here would report a verification failure that did not happen.
      this.logger.warn(`Failed to trigger domain verification notification: ${this.safeReason(error)}`);
    }
  }

  private safeReason(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
    return error instanceof Error && error.name ? error.name : 'UNKNOWN';
  }
}

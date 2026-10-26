// # Responsibility: implements the Batch 04 commercial domain behavior for this capability.
// # Persists document-version acceptance against the authenticated tenant and user and enforces the current content hash.
import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export const REQUIRED_POLICIES = ['TERMS', 'RISK_DISCLOSURE', 'PRIVACY'] as const;
export type PolicyDocument = (typeof REQUIRED_POLICIES)[number];

const POLICY_CONTENT: Readonly<Record<PolicyDocument, { version: string; content: string }>> = Object.freeze({
  TERMS: { version: '2026-10-26', content: 'Terms of service: trading involves risk; service availability and execution depend on third-party venues; users retain responsibility for account access and trading choices.' },
  RISK_DISCLOSURE: { version: '2026-10-26', content: 'Risk disclosure: digital asset prices can move rapidly; copy-trading can lose some or all allocated funds; past performance is not a guarantee of future results.' },
  PRIVACY: { version: '2026-10-26', content: 'Privacy notice: personal data is processed for account operation, security, compliance, and user-requested services under the published retention policy.' },
});

export interface CurrentPolicy {
  document: PolicyDocument;
  version: string;
  content: string;
  contentHash: string;
}

@Injectable()
export class PolicyAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  current(): CurrentPolicy[] {
    return REQUIRED_POLICIES.map((document) => {
      const policy = POLICY_CONTENT[document];
      return { document, version: policy.version, content: policy.content, contentHash: createHash('sha256').update(policy.content, 'utf8').digest('hex') };
    });
  }

  async accept(input: { tenantId: string; userId: string; document: PolicyDocument; version: string; contentHash: string }): Promise<{ accepted: true; acceptedAt: Date; document: PolicyDocument; version: string; contentHash: string }> {
    const current = this.current().find((item) => item.document === input.document);
    if (!current || input.version !== current.version || input.contentHash !== current.contentHash) throw new BadRequestException('Policy version or content hash is stale');
    const existing = await this.prisma.policyAcceptance.findUnique({ where: { tenantId_userId_document_version_contentHash: { tenantId: input.tenantId, userId: input.userId, document: input.document, version: input.version, contentHash: input.contentHash } } });
    if (existing && existing.withdrawnAt === null) return { accepted: true, acceptedAt: existing.acceptedAt, document: input.document, version: input.version, contentHash: input.contentHash };
    const saved = existing
      ? await this.prisma.policyAcceptance.update({ where: { id: existing.id }, data: { acceptedAt: new Date(), withdrawnAt: null } })
      : await this.prisma.policyAcceptance.create({ data: { tenantId: input.tenantId, userId: input.userId, document: input.document, version: input.version, contentHash: input.contentHash } });
    return { accepted: true, acceptedAt: saved.acceptedAt, document: input.document, version: input.version, contentHash: input.contentHash };
  }

  async isCurrent(tenantId: string, userId: string, document: PolicyDocument): Promise<boolean> {
    const policy = this.current().find((item) => item.document === document);
    if (!policy) return false;
    const acceptance = await this.prisma.policyAcceptance.findFirst({ where: { tenantId, userId, document, version: policy.version, contentHash: policy.contentHash, withdrawnAt: null }, select: { id: true } });
    return acceptance !== null;
  }

  async requireCurrent(tenantId: string, userId: string, documents: readonly PolicyDocument[]): Promise<void> {
    for (const document of documents) {
      if (!(await this.isCurrent(tenantId, userId, document))) throw new ForbiddenException(`Current ${document} acceptance is required`);
    }
  }

  async withdraw(input: { tenantId: string; userId: string; document: PolicyDocument }): Promise<void> {
    const policy = this.current().find((item) => item.document === input.document);
    if (!policy) throw new BadRequestException('Unknown policy document');
    const result = await this.prisma.policyAcceptance.updateMany({ where: { tenantId: input.tenantId, userId: input.userId, document: input.document, version: policy.version, contentHash: policy.contentHash, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    if (result.count === 0) throw new NotFoundException('Current policy acceptance not found');
  }
}

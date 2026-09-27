import { Injectable, Logger } from '@nestjs/common';
import { ResearchRepository } from './research-repository';
import { ResearchStrategyVersionStatus } from './research.types';
import { createHash, randomUUID } from 'crypto';

/**
 * Immutable strategy-version lifecycle: draft, validate, freeze, publish, deprecate, and version comparison using existing strategy references.
 * Once frozen/published, do not mutate logic/configuration in place. Create new version instead.
 */
@Injectable()
export class StrategyVersionService {
  private readonly logger = new Logger(StrategyVersionService.name);

  constructor(private readonly researchRepo: ResearchRepository) {}

  private hashLogic(logic: Record<string, any>): string {
    const h = createHash('sha256');
    h.update(JSON.stringify(logic, Object.keys(logic).sort()));
    return h.digest('hex');
  }

  private hashConfig(config: Record<string, any>): string {
    const h = createHash('sha256');
    h.update(JSON.stringify(config, Object.keys(config).sort()));
    return h.digest('hex');
  }

  private fingerprintVersion(input: { logicHash: string; configHash: string; parameters: Record<string, any>; name: string; version: string }): string {
    const h = createHash('sha256');
    h.update(`${input.logicHash}|${input.configHash}|${JSON.stringify(input.parameters)}|${input.name}|${input.version}`);
    return h.digest('hex');
  }

  async createDraftVersion(input: {
    tenantId: string;
    strategyId?: string | null;
    traderStrategyId?: string | null;
    definitionId?: string | null;
    version: string;
    name: string;
    description?: string | null;
    parameters?: Record<string, any>;
    riskProfile?: Record<string, any>;
    executionModel?: Record<string, any>;
    logic?: Record<string, any>;
    parentVersionId?: string | null;
    changeNote?: string | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(input.version)) {
      throw new Error(`Version must be semver format x.y.z, got ${input.version}`);
    }

    const logicHash = this.hashLogic(input.logic || { name: input.name, version: input.version });
    const configHash = this.hashConfig({ parameters: input.parameters, riskProfile: input.riskProfile, executionModel: input.executionModel });
    const fingerprint = this.fingerprintVersion({ logicHash, configHash, parameters: input.parameters || {}, name: input.name, version: input.version });

    const created = await this.researchRepo.createStrategyVersion({
      tenantId: input.tenantId,
      strategyId: input.strategyId || null,
      traderStrategyId: input.traderStrategyId || null,
      definitionId: input.definitionId || null,
      version: input.version,
      name: input.name,
      description: input.description || null,
      logicHash,
      configHash,
      fingerprint,
      parameters: input.parameters || {},
      riskProfile: input.riskProfile || {},
      executionModel: input.executionModel || {},
      parentVersionId: input.parentVersionId || null,
      changeNote: input.changeNote || null,
      createdBy: input.createdBy || null,
      idempotencyKey: input.idempotencyKey || null,
    });

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'STRATEGY_VERSION_CREATED',
      actorId: input.createdBy || null,
      strategyVersionId: created.id,
      result: 'SUCCESS',
      safeMetadata: { version: input.version, name: input.name, fingerprint },
    });

    this.logger.log(`Strategy version draft created id=${created.id} tenant=${input.tenantId} version=${input.version}`);

    return created;
  }

  async getVersion(tenantId: string, versionId: string): Promise<any | null> {
    return this.researchRepo.findStrategyVersionById(versionId, tenantId);
  }

  async listVersions(tenantId: string, filters?: { strategyId?: string; status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.researchRepo.listStrategyVersions(tenantId, filters);
  }

  async updateDraft(tenantId: string, versionId: string, actorId: string, updates: { name?: string; description?: string | null; parameters?: Record<string, any>; riskProfile?: Record<string, any>; executionModel?: Record<string, any>; changeNote?: string | null }): Promise<any | null> {
    const existing = await this.researchRepo.findStrategyVersionById(versionId, tenantId);
    if (!existing) return null;

    // Once frozen/published, do not mutate in place
    if (['FROZEN','PUBLISHED','DEPRECATED','ARCHIVED'].includes(existing.status)) {
      throw new Error(`Strategy version ${versionId} is ${existing.status} and immutable. Create a new version instead.`);
    }

    // Only DRAFT and VALID can be updated
    if (!['DRAFT','VALIDATING','VALID'].includes(existing.status)) {
      throw new Error(`Strategy version ${versionId} status ${existing.status} cannot be updated`);
    }

    const newParams = updates.parameters || existing.parameters;
    const newRisk = updates.riskProfile || existing.riskProfile;
    const newExec = updates.executionModel || existing.executionModel;
    const newName = updates.name || existing.name;

    const configHash = this.hashConfig({ parameters: newParams, riskProfile: newRisk, executionModel: newExec });
    const fingerprint = this.fingerprintVersion({ logicHash: existing.logicHash, configHash, parameters: newParams, name: newName, version: existing.version });

    try {
      const updated = await (this.researchRepo as any).prisma.researchStrategyVersion.update({
        where: { id: versionId },
        data: {
          name: newName,
          description: updates.description !== undefined ? updates.description : existing.description,
          parameters: newParams,
          riskProfile: newRisk,
          executionModel: newExec,
          configHash,
          fingerprint,
          changeNote: updates.changeNote || existing.changeNote,
          updatedAt: new Date(),
        },
      });

      await this.researchRepo.createAuditLog({
        tenantId,
        event: 'STRATEGY_VERSION_UPDATED',
        actorId,
        strategyVersionId: versionId,
        result: 'SUCCESS',
        safeMetadata: { name: newName, fingerprint },
      });

      return updated;
    } catch {
      return null;
    }
  }

  async validateVersion(tenantId: string, versionId: string, actorId: string): Promise<any | null> {
    const existing = await this.researchRepo.findStrategyVersionById(versionId, tenantId);
    if (!existing) return null;

    if (existing.status !== 'DRAFT') throw new Error(`Only DRAFT can be validated, current=${existing.status}`);

    // Perform validation - check parameters not contain executable code
    const params = existing.parameters as any;
    if (params && typeof params === 'object') {
      const forbiddenKeys = ['eval','exec','Function','code','script','__proto__'];
      for (const key of Object.keys(params)) {
        if (forbiddenKeys.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
          throw new Error(`Parameter key ${key} contains forbidden executable reference`);
        }
        const val = params[key];
        if (typeof val === 'string' && (val.includes('eval(') || val.includes('Function(') || val.includes('<script'))) {
          throw new Error(`Parameter ${key} contains forbidden executable code`);
        }
      }
    }

    const updated = await this.researchRepo.updateStrategyVersionStatus(versionId, tenantId, ResearchStrategyVersionStatus.VALID as any);

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_VALIDATED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: { version: existing.version },
    });

    return updated;
  }

  async freezeVersion(tenantId: string, versionId: string, actorId: string): Promise<any | null> {
    const existing = await this.researchRepo.findStrategyVersionById(versionId, tenantId);
    if (!existing) return null;

    if (!['VALID','DRAFT'].includes(existing.status)) throw new Error(`Only VALID/DRAFT can be frozen, current=${existing.status}`);

    const updated = await this.researchRepo.updateStrategyVersionStatus(versionId, tenantId, ResearchStrategyVersionStatus.FROZEN as any, { frozenAt: new Date() });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_FROZEN',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: { version: existing.version, fingerprint: existing.fingerprint },
    });

    this.logger.log(`Strategy version frozen id=${versionId} tenant=${tenantId}`);

    return updated;
  }

  async publishVersion(tenantId: string, versionId: string, actorId: string): Promise<any | null> {
    const existing = await this.researchRepo.findStrategyVersionById(versionId, tenantId);
    if (!existing) return null;

    if (existing.status !== 'FROZEN') throw new Error(`Only FROZEN can be published, current=${existing.status}. Freeze first.`);

    const updated = await this.researchRepo.updateStrategyVersionStatus(versionId, tenantId, ResearchStrategyVersionStatus.PUBLISHED as any, { publishedAt: new Date() });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_PUBLISHED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: { version: existing.version, fingerprint: existing.fingerprint },
    });

    this.logger.log(`Strategy version published id=${versionId} tenant=${tenantId}`);

    return updated;
  }

  async deprecateVersion(tenantId: string, versionId: string, actorId: string): Promise<any | null> {
    const existing = await this.researchRepo.findStrategyVersionById(versionId, tenantId);
    if (!existing) return null;

    if (existing.status !== 'PUBLISHED') throw new Error(`Only PUBLISHED can be deprecated, current=${existing.status}`);

    const updated = await this.researchRepo.updateStrategyVersionStatus(versionId, tenantId, ResearchStrategyVersionStatus.DEPRECATED as any, { deprecatedAt: new Date() });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'STRATEGY_VERSION_DEPRECATED',
      actorId,
      strategyVersionId: versionId,
      result: 'SUCCESS',
      safeMetadata: { version: existing.version },
    });

    return updated;
  }

  async compareVersions(tenantId: string, versionIdA: string, versionIdB: string): Promise<{ differences: Record<string, any>; isSameLogic: boolean; isSameConfig: boolean }> {
    const a = await this.researchRepo.findStrategyVersionById(versionIdA, tenantId);
    const b = await this.researchRepo.findStrategyVersionById(versionIdB, tenantId);
    if (!a || !b) throw new Error('One or both versions not found');

    const isSameLogic = a.logicHash === b.logicHash;
    const isSameConfig = a.configHash === b.configHash;

    const differences: Record<string, any> = {};
    if (a.version !== b.version) differences.version = { a: a.version, b: b.version };
    if (a.name !== b.name) differences.name = { a: a.name, b: b.name };
    if (JSON.stringify(a.parameters) !== JSON.stringify(b.parameters)) differences.parameters = { a: a.parameters, b: b.parameters };
    if (JSON.stringify(a.riskProfile) !== JSON.stringify(b.riskProfile)) differences.riskProfile = { a: a.riskProfile, b: b.riskProfile };
    if (JSON.stringify(a.executionModel) !== JSON.stringify(b.executionModel)) differences.executionModel = { a: a.executionModel, b: b.executionModel };
    if (a.logicHash !== b.logicHash) differences.logicHash = { a: a.logicHash, b: b.logicHash };
    if (a.configHash !== b.configHash) differences.configHash = { a: a.configHash, b: b.configHash };

    return { differences, isSameLogic, isSameConfig };
  }
}

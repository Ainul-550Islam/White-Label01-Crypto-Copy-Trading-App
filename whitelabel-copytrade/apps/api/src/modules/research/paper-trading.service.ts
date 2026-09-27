import { Injectable, Logger } from '@nestjs/common';
import { PaperTradingRepository } from './paper-trading-repository';
import { ResearchRepository } from './research-repository';
import { ResearchPolicyService } from './research-policy.service';
import { randomUUID } from 'crypto';

/**
 * Starts/stops/manages paper-trading sessions using market data and simulated execution without touching live order records.
 * Paper session must be physically/logically separated from live account state.
 */
@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);

  constructor(
    private readonly paperRepo: PaperTradingRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly policyService: ResearchPolicyService,
  ) {}

  async createSession(input: {
    tenantId: string;
    strategyVersionId: string;
    initialCapital: string;
    symbols?: string[];
    timeframe?: string;
    config?: Record<string, any>;
    expiresAt?: Date | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<any> {
    // Validate strategy version exists and is at least FROZEN
    const strategyVersion = await this.researchRepo.findStrategyVersionById(input.strategyVersionId, input.tenantId);
    if (!strategyVersion) throw new Error(`Strategy version ${input.strategyVersionId} not found`);
    if (!['FROZEN','PUBLISHED'].includes(strategyVersion.status)) throw new Error(`Strategy version must be FROZEN/PUBLISHED to start paper trading, current=${strategyVersion.status}`);

    // Validate initial capital Decimal-safe
    if (!/^-?\d+(\.\d+)?$/.test(input.initialCapital)) throw new Error('initialCapital must be valid decimal string');
    if (parseFloat(input.initialCapital) <= 0) throw new Error('initialCapital must be positive');

    const sessionIdentifier = `paper_${input.strategyVersionId.substring(0,8)}_${Date.now()}_${randomUUID().substring(0,6)}`;

    const session = await this.paperRepo.createSession({
      tenantId: input.tenantId,
      strategyVersionId: input.strategyVersionId,
      sessionIdentifier,
      config: input.config || {},
      initialCapital: input.initialCapital,
      symbols: input.symbols || [],
      timeframe: input.timeframe || '1m',
      expiresAt: input.expiresAt || null,
      createdBy: input.createdBy || null,
      idempotencyKey: input.idempotencyKey || null,
    });

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'PAPER_SESSION_CREATED',
      actorId: input.createdBy || null,
      strategyVersionId: input.strategyVersionId,
      paperSessionId: session.id,
      result: 'SUCCESS',
      safeMetadata: { sessionIdentifier, initialCapital: input.initialCapital, symbols: input.symbols },
    });

    this.logger.log(`Paper session created id=${session.id} tenant=${input.tenantId} strategyVersion=${input.strategyVersionId}`);

    return session;
  }

  async startSession(tenantId: string, sessionId: string, actorId: string): Promise<any | null> {
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) return null;

    if (session.status !== 'CREATED') throw new Error(`Only CREATED session can be started, current=${session.status}`);

    const updated = await this.paperRepo.updateSessionStatus(sessionId, tenantId, 'RUNNING', { startedAt: new Date() });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_STARTED',
      actorId,
      strategyVersionId: session.strategyVersionId,
      paperSessionId: sessionId,
      result: 'SUCCESS',
      safeMetadata: { sessionIdentifier: session.sessionIdentifier },
    });

    this.logger.log(`Paper session started id=${sessionId} tenant=${tenantId} PAPER_SIMULATION`);

    return updated;
  }

  async pauseSession(tenantId: string, sessionId: string, actorId: string): Promise<any | null> {
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) return null;
    if (session.status !== 'RUNNING') throw new Error(`Only RUNNING session can be paused, current=${session.status}`);

    const updated = await this.paperRepo.updateSessionStatus(sessionId, tenantId, 'PAUSED');

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_PAUSED',
      actorId,
      strategyVersionId: session.strategyVersionId,
      paperSessionId: sessionId,
      result: 'SUCCESS',
      safeMetadata: {},
    });

    return updated;
  }

  async resumeSession(tenantId: string, sessionId: string, actorId: string): Promise<any | null> {
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) return null;
    if (session.status !== 'PAUSED') throw new Error(`Only PAUSED session can be resumed, current=${session.status}`);

    const updated = await this.paperRepo.updateSessionStatus(sessionId, tenantId, 'RUNNING');

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_RESUMED',
      actorId,
      strategyVersionId: session.strategyVersionId,
      paperSessionId: sessionId,
      result: 'SUCCESS',
      safeMetadata: {},
    });

    return updated;
  }

  async stopSession(tenantId: string, sessionId: string, actorId: string, reason?: string): Promise<any | null> {
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) return null;

    if (['STOPPED','FAILED','EXPIRED'].includes(session.status)) throw new Error(`Session already ${session.status}`);

    const updated = await this.paperRepo.updateSessionStatus(sessionId, tenantId, 'STOPPED', { stoppedAt: new Date() });

    await this.researchRepo.createAuditLog({
      tenantId,
      event: 'PAPER_SESSION_STOPPED',
      actorId,
      strategyVersionId: session.strategyVersionId,
      paperSessionId: sessionId,
      result: 'SUCCESS',
      safeMetadata: { reason: reason || 'Manual stop' },
    });

    this.logger.log(`Paper session stopped id=${sessionId} tenant=${tenantId} reason=${reason}`);

    return updated;
  }

  async getSession(tenantId: string, sessionId: string): Promise<any | null> {
    return this.paperRepo.findSessionById(sessionId, tenantId);
  }

  async listSessions(tenantId: string, filters?: { strategyVersionId?: string; status?: string; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.paperRepo.listSessions(tenantId, filters);
  }

  async checkMinimumDuration(tenantId: string, sessionId: string): Promise<{ meets: boolean; durationMinutes: number; requiredMinutes: number }> {
    const policy = await this.policyService.getPolicy(tenantId);
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) throw new Error('Session not found');

    const start = session.startedAt ? new Date(session.startedAt).getTime() : new Date(session.createdAt).getTime();
    const end = session.stoppedAt ? new Date(session.stoppedAt).getTime() : Date.now();
    const durationMinutes = (end - start) / (1000*60);

    return { meets: durationMinutes >= policy.paperTradingMinimumDurationMinutes, durationMinutes, requiredMinutes: policy.paperTradingMinimumDurationMinutes };
  }
}

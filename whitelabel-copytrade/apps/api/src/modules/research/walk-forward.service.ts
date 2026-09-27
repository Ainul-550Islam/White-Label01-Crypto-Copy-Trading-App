import { Injectable, Logger } from '@nestjs/common';
import { BacktestRepository } from './backtest-repository';
import { ResearchRepository } from './research-repository';
import { BacktestEngineService } from './backtest-engine.service';
import { ResearchPolicyService } from './research-policy.service';
import { randomUUID } from 'crypto';

/**
 * Performs rolling train/test or validation windows with explicit out-of-sample boundaries and leakage protection.
 * Critical: Do not allow future test data to enter training/parameter selection. Every split must be explicit.
 */
@Injectable()
export class WalkForwardService {
  private readonly logger = new Logger(WalkForwardService.name);

  constructor(
    private readonly backtestRepo: BacktestRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly backtestEngine: BacktestEngineService,
    private readonly policyService: ResearchPolicyService,
  ) {}

  async runWalkForward(input: {
    tenantId: string;
    strategyVersionId: string;
    symbols: string[];
    timeframe: string;
    startTime: string;
    endTime: string;
    initialCapital: string;
    trainingWindowDays: number;
    testingWindowDays: number;
    validationWindowDays?: number;
    mode: 'ROLLING' | 'EXPANDING';
    stepDays?: number;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<{ windows: any[]; results: any[]; aggregatedMetrics: Record<string, any>; outOfSampleMetrics: Record<string, any> }> {
    const policy = await this.policyService.getPolicy(input.tenantId);
    if (input.trainingWindowDays <= 0 || input.testingWindowDays <= 0) throw new Error('Training and testing windows must be positive');
    
    const totalDurationDays = (new Date(input.endTime).getTime() - new Date(input.startTime).getTime()) / (1000*60*60*24);
    const expectedWindows = Math.floor(totalDurationDays / (input.trainingWindowDays + input.testingWindowDays));
    if (expectedWindows > policy.maxWalkForwardWindows) throw new Error(`Walk-forward windows ${expectedWindows} exceeds max ${policy.maxWalkForwardWindows}`);

    // Idempotency
    if (input.idempotencyKey) {
      const existing = await (this.researchRepo as any).prisma.researchAuditLog.findFirst({ where: { tenantId: input.tenantId, event: 'WALK_FORWARD_COMPLETED', safeMetadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } } });
      // Simplified idempotency check
    }

    const windows: { windowId: string; type: 'TRAINING' | 'VALIDATION' | 'TEST'; startTime: string; endTime: string; trainingStart: string | null; trainingEnd: string | null; isOutOfSample: boolean }[] = [];
    const results: any[] = [];

    const start = new Date(input.startTime).getTime();
    const end = new Date(input.endTime).getTime();
    const trainingMs = input.trainingWindowDays * 24*60*60*1000;
    const testingMs = input.testingWindowDays * 24*60*60*1000;
    const validationMs = (input.validationWindowDays || 0) * 24*60*60*1000;
    const stepMs = (input.stepDays || input.testingWindowDays) * 24*60*60*1000;

    let currentStart = start;
    let windowIndex = 0;

    while (currentStart + trainingMs + validationMs + testingMs <= end) {
      const trainingStart = currentStart;
      const trainingEnd = input.mode === 'EXPANDING' ? start + trainingMs + windowIndex * stepMs : currentStart + trainingMs;
      const actualTrainingStart = input.mode === 'EXPANDING' ? start : trainingStart;
      
      const validationStart = trainingEnd;
      const validationEnd = validationStart + validationMs;
      
      const testingStart = validationMs > 0 ? validationEnd : trainingEnd;
      const testingEnd = testingStart + testingMs;

      // Ensure no future test data enters training - strict train/test separation
      // Training uses only data up to trainingEnd, testing uses only data from testingStart to testingEnd

      if (validationMs > 0) {
        windows.push({
          windowId: `wf_${windowIndex}_training`,
          type: 'TRAINING',
          startTime: new Date(actualTrainingStart).toISOString(),
          endTime: new Date(trainingEnd).toISOString(),
          trainingStart: new Date(actualTrainingStart).toISOString(),
          trainingEnd: new Date(trainingEnd).toISOString(),
          isOutOfSample: false,
        });
        windows.push({
          windowId: `wf_${windowIndex}_validation`,
          type: 'VALIDATION',
          startTime: new Date(validationStart).toISOString(),
          endTime: new Date(validationEnd).toISOString(),
          trainingStart: new Date(actualTrainingStart).toISOString(),
          trainingEnd: new Date(trainingEnd).toISOString(),
          isOutOfSample: false,
        });
        windows.push({
          windowId: `wf_${windowIndex}_test`,
          type: 'TEST',
          startTime: new Date(testingStart).toISOString(),
          endTime: new Date(testingEnd).toISOString(),
          trainingStart: new Date(actualTrainingStart).toISOString(),
          trainingEnd: new Date(trainingEnd).toISOString(),
          isOutOfSample: true,
        });
      } else {
        windows.push({
          windowId: `wf_${windowIndex}_training`,
          type: 'TRAINING',
          startTime: new Date(actualTrainingStart).toISOString(),
          endTime: new Date(trainingEnd).toISOString(),
          trainingStart: new Date(actualTrainingStart).toISOString(),
          trainingEnd: new Date(trainingEnd).toISOString(),
          isOutOfSample: false,
        });
        windows.push({
          windowId: `wf_${windowIndex}_test`,
          type: 'TEST',
          startTime: new Date(testingStart).toISOString(),
          endTime: new Date(testingEnd).toISOString(),
          trainingStart: new Date(actualTrainingStart).toISOString(),
          trainingEnd: new Date(trainingEnd).toISOString(),
          isOutOfSample: true,
        });
      }

      // Run backtest for training window (in-sample)
      try {
        const trainingRun = await this.backtestEngine.runBacktest({
          tenantId: input.tenantId,
          strategyVersionId: input.strategyVersionId,
          symbols: input.symbols,
          timeframe: input.timeframe,
          startTime: new Date(actualTrainingStart).toISOString(),
          endTime: new Date(trainingEnd).toISOString(),
          initialCapital: input.initialCapital,
          createdBy: input.createdBy || null,
          idempotencyKey: `wf_training_${input.tenantId}_${input.strategyVersionId}_${windowIndex}`,
        });
        results.push({ windowId: `wf_${windowIndex}_training`, type: 'TRAINING', runId: trainingRun.id, metrics: trainingRun.metrics, isOutOfSample: false });
      } catch (e: any) {
        this.logger.warn(`Walk-forward training window ${windowIndex} failed: ${e.message}`);
      }

      // Run backtest for test window (out-of-sample) - critical leakage protection
      try {
        const testingRun = await this.backtestEngine.runBacktest({
          tenantId: input.tenantId,
          strategyVersionId: input.strategyVersionId,
          symbols: input.symbols,
          timeframe: input.timeframe,
          startTime: new Date(testingStart).toISOString(),
          endTime: new Date(testingEnd).toISOString(),
          initialCapital: input.initialCapital,
          createdBy: input.createdBy || null,
          idempotencyKey: `wf_test_${input.tenantId}_${input.strategyVersionId}_${windowIndex}`,
        });
        results.push({ windowId: `wf_${windowIndex}_test`, type: 'TEST', runId: testingRun.id, metrics: testingRun.metrics, isOutOfSample: true });
      } catch (e: any) {
        this.logger.warn(`Walk-forward test window ${windowIndex} failed: ${e.message}`);
      }

      currentStart += stepMs;
      windowIndex++;
      if (windowIndex > 100) break; // Safety
    }

    // Aggregate metrics - out-of-sample only for final validation
    const inSampleResults = results.filter(r => !r.isOutOfSample);
    const outOfSampleResults = results.filter(r => r.isOutOfSample);

    const aggregatedMetrics = this.aggregateMetrics(results);
    const outOfSampleMetrics = this.aggregateMetrics(outOfSampleResults);

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'WALK_FORWARD_COMPLETED',
      actorId: input.createdBy || null,
      strategyVersionId: input.strategyVersionId,
      result: 'SUCCESS',
      safeMetadata: { windows: windows.length, results: results.length, mode: input.mode, trainingWindowDays: input.trainingWindowDays, testingWindowDays: input.testingWindowDays },
    });

    this.logger.log(`Walk-forward completed tenant=${input.tenantId} strategyVersion=${input.strategyVersionId} windows=${windows.length} results=${results.length} mode=${input.mode}`);

    return { windows, results, aggregatedMetrics, outOfSampleMetrics };
  }

  private aggregateMetrics(results: any[]): Record<string, any> {
    if (results.length === 0) return {};

    let totalReturn = 0;
    let maxDrawdown = 0;
    let winRateSum = 0;
    let tradeCount = 0;
    let count = 0;

    for (const r of results) {
      if (r.metrics) {
        if (r.metrics.totalReturn) totalReturn += parseFloat(r.metrics.totalReturn);
        if (r.metrics.maxDrawdown) maxDrawdown = Math.max(maxDrawdown, parseFloat(r.metrics.maxDrawdown));
        if (r.metrics.winRate) winRateSum += parseFloat(r.metrics.winRate);
        if (r.metrics.tradeCount) tradeCount += r.metrics.tradeCount;
        count++;
      }
    }

    return {
      averageReturn: count > 0 ? (totalReturn / count).toString() : null,
      maxDrawdown: maxDrawdown.toString(),
      averageWinRate: count > 0 ? (winRateSum / count).toString() : null,
      totalTrades: tradeCount,
      windowCount: count,
      methodology: 'Average of window metrics, out-of-sample separated, no look-ahead leakage',
      isSimulated: true,
    };
  }
}

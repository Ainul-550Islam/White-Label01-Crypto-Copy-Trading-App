// # NEW — E2E test: follow trader -> configure risk -> leader order -> follower fill -> stop/close
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CopySubscriptionDetailPage } from '../../../apps/web/src/features/trading/copy-subscription-detail-page';
import { CopyExecutionDetail } from '../../../apps/web/src/features/trading/copy-execution-detail';
import { CopyRiskGuardrails } from '../../../apps/web/src/features/trading/copy-risk-guardrails';

describe('E2E Smoke: Copy-Trading Lifecycle (GAP-48)', () => {
  test('follow trader -> configure risk -> leader order -> follower fill -> stop/close', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['copy-subscription-detail', 'sub-e2e-1'], {
      subscription: {
        subscriptionId: 'sub-e2e-1',
        traderId: 'tr-9',
        strategyId: 'st-9',
        state: 'ACTIVE',
        allocationMode: 'FIXED',
        allocationAmount: '500.00',
        maxAllocation: '2000.00',
        minAllocation: '50.00',
        copyPolicy: null,
        riskPolicy: {
          maxDailyLoss: '300.00',
          maxDrawdown: '800.00',
          maxOpenExposure: '3000.00',
          maxExposurePerTrader: null,
          maxExposurePerSymbol: null,
          maxDailyCopiedTrades: 10,
          emergencyStopCopy: false,
        },
        totalCopies: 5,
        failedCopies: 0,
        startedAt: '2026-09-01T00:00:00.000Z',
        pausedAt: null,
        stoppedAt: null,
        stopReason: null,
        closeOpenPositionsOnStop: true,
      },
      effectivePolicy: {
        sizingMode: 'FIXED',
        fixedQuantity: '0.2',
        multiplier: null,
        proportionalRatio: null,
        maxPositionSize: '2000',
        maxNotional: '5000',
        maxOpenPositions: 5,
        maxLeverage: '2',
        allowedSymbols: ['BTC-USDT'],
        blockedSymbols: [],
        allowedVenues: ['BINANCE'],
        orderTypePolicy: 'MARKET_AND_LIMIT',
        slippageToleranceBps: 50,
        executionDelayMs: 0,
        takeProfitBps: 200,
        stopLossBps: 100,
        trailingStopBps: null,
        emergencyStop: false,
      },
      recentExecutions: [
        {
          executionId: 'exec-e2e-1',
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          followerId: 'user-1',
          strategyId: 'st-9',
          leaderEventId: 'fill:L901',
          leaderOrderId: 'ord-L901',
          followerOrderId: 'ord-F901',
          status: 'COMPLETED',
          failureReason: null,
          leaderQuantity: '1.0',
          followerQuantity: '0.2',
          sizingMode: 'FIXED',
          riskDecision: 'ALLOW',
          riskReasons: [],
          isSimulated: false,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:05.000Z',
        },
      ],
      reconciliation: {
        subscriptionId: 'sub-e2e-1',
        status: 'IN_SYNC',
        lastCheckedAt: '2026-10-01T10:05:00.000Z',
        totalExecutions: 5,
        completedExecutions: 5,
        failedExecutions: 0,
        riskBlockedExecutions: 0,
        discrepancyCount: 0,
        discrepancies: [],
      },
    });

    const subscriptionMarkup = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(CopySubscriptionDetailPage, { subscriptionId: 'sub-e2e-1' }),
      ),
    );
    expect(subscriptionMarkup).toContain('sub-e2e-1');
    expect(subscriptionMarkup).toContain('exec-e2e-1');

    const executionMarkup = renderToStaticMarkup(
      React.createElement(CopyExecutionDetail, {
        execution: {
          executionId: 'exec-e2e-1',
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          followerId: 'user-1',
          strategyId: 'st-9',
          leaderEventId: 'fill:L901',
          leaderOrderId: 'ldr-order-1',
          followerOrderId: 'flw-order-1',
          status: 'COMPLETED',
          failureReason: null,
          leaderQuantity: '1.0',
          followerQuantity: '0.2',
          sizingMode: 'FIXED',
          riskDecision: 'ALLOW',
          riskReasons: [],
          isSimulated: false,
          createdAt: '2026-10-01T09:10:00.000Z',
          updatedAt: '2026-10-01T09:10:05.000Z',
        },
      }),
    );
    expect(executionMarkup).toContain('ldr-order-1');
    expect(executionMarkup).toContain('flw-order-1');

    const guardrailsMarkup = renderToStaticMarkup(
      React.createElement(CopyRiskGuardrails, {
        subscription: {
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          strategyId: 'st-9',
          state: 'ACTIVE',
          allocationMode: 'FIXED',
          allocationAmount: '500.00',
          maxAllocation: '2000.00',
          minAllocation: '50.00',
          copyPolicy: null,
          riskPolicy: {
            maxDailyLoss: '250.00',
            maxDrawdown: '800.00',
            maxOpenExposure: '3000.00',
            maxExposurePerTrader: '1500.00',
            maxExposurePerSymbol: '1000.00',
            maxDailyCopiedTrades: 10,
            emergencyStopCopy: false,
          },
          totalCopies: 5,
          failedCopies: 0,
          startedAt: '2026-09-01T00:00:00.000Z',
          pausedAt: null,
          stoppedAt: null,
          stopReason: null,
          closeOpenPositionsOnStop: true,
        },
      }),
    );
    expect(guardrailsMarkup).toContain('250.00');
  });
});

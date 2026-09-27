import { Injectable, Logger } from '@nestjs/common';

/**
 * Provides structured operational runbooks for known failure classes, including
 * prerequisite checks, diagnostic evidence, safe actions, forbidden actions,
 * recovery order, verification steps, and completion criteria.
 * Runbooks must describe real existing service boundaries.
 */

export interface RunbookStep {
  order: number;
  title: string;
  description: string;
  command?: string;
  service: string;
  isSafe: boolean;
  isForbidden?: boolean;
  verification?: string;
}

export interface Runbook {
  id: string;
  failureClass: string;
  title: string;
  description: string;
  severity: string;
  prerequisites: string[];
  diagnostics: string[];
  safeActions: RunbookStep[];
  forbiddenActions: string[];
  recoveryOrder: string[];
  verificationSteps: string[];
  completionCriteria: string[];
  relatedServices: string[];
  estimatedDurationMinutes: number;
}

@Injectable()
export class RunbookService {
  private readonly logger = new Logger(RunbookService.name);

  private readonly RUNBOOKS: Runbook[] = [
    {
      id: 'queue-failure',
      failureClass: 'QUEUE_FAILURE',
      title: 'Queue Connectivity Failure',
      description: 'BullMQ queues unavailable or not processing jobs',
      severity: 'CRITICAL',
      prerequisites: ['Redis connectivity', 'Queue service availability', 'Worker processes'],
      diagnostics: [
        'Check Redis health via DependencyHealthService',
        'Check queue depths via QueueHealthService.getDepths()',
        'Check for paused queues',
        'Review recent operational audit logs for queue health checks',
      ],
      safeActions: [
        { order: 1, title: 'Verify Redis', description: 'Check Redis health', service: 'DependencyHealthService.checkRedis', isSafe: true, verification: 'Redis PING returns PONG' },
        { order: 2, title: 'Check queue connectivity', description: 'Evaluate queue health', service: 'QueueHealthService.evaluate', isSafe: true, verification: 'All queues report isConnected=true' },
        { order: 3, title: 'Retry failed jobs', description: 'Retry via existing queue infrastructure, not direct DB', service: 'QueueService', isSafe: true, verification: 'Failed count decreases' },
      ],
      forbiddenActions: [
        'Directly patching job status in database to simulate success',
        'Marking queue as healthy without evidence',
        'Bypassing distributed locks',
        'Inventing queue success metrics',
      ],
      recoveryOrder: ['check-redis', 'check-queues', 'retry-failed', 'verify-processing'],
      verificationSteps: ['Queue depths show waiting decreasing', 'No stale jobs older than 5m', 'Audit log shows queue health check success'],
      completionCriteria: ['All queues connected', 'Failed jobs < 10', 'No paused queues unless maintenance active'],
      relatedServices: ['RedisService', 'QueueService', 'QueueHealthService', 'OperationalAuditService'],
      estimatedDurationMinutes: 15,
    },
    {
      id: 'database-unavailable',
      failureClass: 'DATABASE_UNAVAILABLE',
      title: 'Database Unavailable',
      description: 'PostgreSQL primary unavailable or misconfigured',
      severity: 'CRITICAL',
      prerequisites: ['Database URL configured', 'Network connectivity', 'Credentials valid'],
      diagnostics: [
        'Check DATABASE_URL env present (never log value)',
        'Run Prisma $queryRaw SELECT 1 via DependencyHealthService.checkDatabase',
        'Check connection pool metrics',
        'Review recent readiness checks blocking reasons',
      ],
      safeActions: [
        { order: 1, title: 'Check configuration', description: 'Verify DATABASE_URL exists, not value', service: 'DependencyHealthService.checkConfiguration', isSafe: true },
        { order: 2, title: 'Test connectivity', description: 'SELECT 1 via Prisma', service: 'DependencyHealthService.checkDatabase', isSafe: true, verification: 'Query returns 1' },
        { order: 3, title: 'Fail closed', description: 'System should fail closed for critical DB dependency', service: 'SystemReadinessService', isSafe: true },
      ],
      forbiddenActions: [
        'Reporting database healthy without actual query',
        'Bypassing tenant isolation to test',
        'Exposing credentials in logs',
        'Inventing reconciliation success to hide DB failure',
      ],
      recoveryOrder: ['check-config', 'test-connectivity', 'verify-readiness'],
      verificationSteps: ['Database health returns HEALTHY', 'Readiness state returns READY or DEGRADED not NOT_READY due to DB'],
      completionCriteria: ['Database check returns HEALTHY', 'Latency < 500ms', 'No blocking reasons for DB'],
      relatedServices: ['PrismaService', 'DependencyHealthService', 'SystemReadinessService'],
      estimatedDurationMinutes: 10,
    },
    {
      id: 'oms-stale',
      failureClass: 'OMS_STALE',
      title: 'OMS Stale Orders',
      description: 'OMS orders stuck in SUBMITTED/ACKNOWLEDGED beyond expected time',
      severity: 'ERROR',
      prerequisites: ['OMS tables accessible', 'Execution engine connectivity', 'Exchange connectivity'],
      diagnostics: [
        'List OMS intents with state SUBMITTED/ACKNOWLEDGED older than 10m via OrderReconciliationService',
        'Check execution engine Order table for corresponding orders',
        'Check exchange for provider order existence',
        'Review OMS audit trail for missing ACK',
      ],
      safeActions: [
        { order: 1, title: 'Run OMS order reconciliation', description: 'Delegate to OrderReconciliationService, diagnostic only', service: 'OrderReconciliationService', isSafe: true, verification: 'Reconciliation run returns SUCCEEDED with mismatches listed' },
        { order: 2, title: 'Check execution engine', description: 'Verify order exists in execution engine via ExecutionOrdersService', service: 'ExecutionOrdersService', isSafe: true },
        { order: 3, title: 'Operator acknowledge', description: 'Acknowledge operational exception via TradeOperationsService', service: 'TradeOperationsService', isSafe: true },
      ],
      forbiddenActions: [
        'Marking order FILLED without provider confirmation',
        'Directly updating order status in DB to simulate success',
        'Inventing fills',
        'Bypassing OMS to place exchange order directly',
        'Bypassing live-gate, risk, compliance',
      ],
      recoveryOrder: ['reconcile-oms-orders', 'check-engine', 'check-exchange', 'operator-acknowledge'],
      verificationSteps: ['Reconciliation run shows no missing provider orders', 'OMS order transitions to ACKNOWLEDGED or REJECTED via valid transition'],
      completionCriteria: ['No stale orders older than 10m', 'All SUBMITTED orders have ACK or are in reconciliation'],
      relatedServices: ['OrderReconciliationService', 'ExecutionOrdersService', 'OmsAuditService', 'TradeOperationsService'],
      estimatedDurationMinutes: 20,
    },
    {
      id: 'exchange-disconnect',
      failureClass: 'EXCHANGE_DISCONNECT',
      title: 'Exchange Connectivity Failure',
      description: 'Exchange venue unavailable or credential failure',
      severity: 'CRITICAL',
      prerequisites: ['Exchange enabled', 'Credential source configured', 'IP allowlist', 'Venue attestation'],
      diagnostics: [
        'Check exchange health via DependencyHealthService.checkExchangeConnectivity',
        'Check credential source via DependencyHealthService.checkCredentialSource — missing config is not healthy',
        'Check exchange stream sessions for disconnects',
        'Review execution incidents for credential failures',
      ],
      safeActions: [
        { order: 1, title: 'Verify credential source', description: 'Check credential exists via ExchangeAccountsService, never expose secret', service: 'ExchangeAccountsService', isSafe: true },
        { order: 2, title: 'Check IP allowlist', description: 'Verify IP allowlisting via existing service', service: 'SecurityService', isSafe: true },
        { order: 3, title: 'Reconnect via execution safety', description: 'Reconnect stream via ExecutionSafetyService boundary, not direct', service: 'ExecutionSafetyService', isSafe: true, verification: 'Stream session CONNECTED' },
        { order: 4, title: 'Run exchange reconciliation', description: 'Delegate to exchange account reconciliation', service: 'ReconciliationOrchestratorService', isSafe: true },
      ],
      forbiddenActions: [
        'Marking exchange account HEALTHY without evidence',
        'Bypassing credential controls',
        'Bypassing venue attestation',
        'Bypassing IP allowlisting',
        'Bypassing signed transport',
        'Activating LIVE mode directly',
        'Inventing fills to simulate connectivity',
      ],
      recoveryOrder: ['verify-credential', 'check-ip-allowlist', 'check-venue-attestation', 'reconnect-stream', 'reconcile-exchange'],
      verificationSteps: ['Exchange dependency returns HEALTHY', 'Stream session CONNECTED', 'No credential failure incidents'],
      completionCriteria: ['Exchange connectivity HEALTHY', 'At least one stream session CONNECTED', 'No active credential failure'],
      relatedServices: ['ExchangeAccountsService', 'ExecutionSafetyService', 'DependencyHealthService', 'ReconciliationOrchestratorService'],
      estimatedDurationMinutes: 25,
    },
    {
      id: 'risk-block-storm',
      failureClass: 'RISK_BLOCK_STORM',
      title: 'Risk Block Storm',
      description: 'High volume of risk-blocked orders, possible misconfiguration',
      severity: 'WARNING',
      prerequisites: ['Risk policy exists', 'Risk decision service available', 'Market data available'],
      diagnostics: [
        'Check risk reconciliation via ReconciliationOrchestratorService RISK type',
        'Review risk decision records for blocking reasons',
        'Check risk policy version and active status',
        'Check for stale market data causing blocks',
      ],
      safeActions: [
        { order: 1, title: 'Review risk policy', description: 'Check policy via RiskManagement snapshot, never trust client balances', service: 'RiskManagementSnapshotRepository', isSafe: true },
        { order: 2, title: 'Check market data staleness', description: 'Verify market data age', service: 'DependencyHealthService', isSafe: true },
        { order: 3, title: 'Operator review', description: 'Operator reviews risk blocks via risk dashboard, does not directly approve risk decision', service: 'RiskDecisionService', isSafe: true },
      ],
      forbiddenActions: [
        'Approving risk decision directly in operations module',
        'Clearing risk block without authoritative risk service',
        'Inventing risk approval',
        'Bypassing risk to place order',
        'Using client-provided balances/equity',
      ],
      recoveryOrder: ['check-policy', 'check-market-data', 'review-blocks', 'operator-action'],
      verificationSteps: ['Risk reconciliation SUCCEEDED', 'Blocking reasons understood', 'No direct risk approval in ops'],
      completionCriteria: ['Risk blocks explained by policy', 'No bypass of risk engine'],
      relatedServices: ['RiskDecisionService', 'RiskPolicyService', 'RiskReconciliationService'],
      estimatedDurationMinutes: 30,
    },
    {
      id: 'billing-failure',
      failureClass: 'BILLING_FAILURE',
      title: 'Billing/Finance Reconciliation Failure',
      description: 'Payment, invoice, fee, or usage reconciliation mismatch',
      severity: 'ERROR',
      prerequisites: ['Billing module available', 'Finance ledger accessible', 'Payment provider configured'],
      diagnostics: [
        'Run BILLING_FINANCE reconciliation via orchestrator',
        'Check fee accrual vs settlement',
        'Check usage events vs meters',
        'Check invoice vs payment status',
      ],
      safeActions: [
        { order: 1, title: 'Run billing reconciliation', description: 'Delegate to BillingReconciliationService via orchestrator', service: 'ReconciliationOrchestratorService', isSafe: true },
        { order: 2, title: 'Run fee reconciliation', description: 'Delegate to FeeReconciliationService', service: 'FeeReconciliationService', isSafe: true },
        { order: 3, title: 'Run usage reconciliation', description: 'Delegate to Usage service', service: 'UsageService', isSafe: true },
      ],
      forbiddenActions: [
        'Inventing payment success',
        'Inventing invoice settlement',
        'Inventing usage',
        'Directly patching ledger to simulate success',
        'Marking reconciliation successful when delegated service failed',
      ],
      recoveryOrder: ['reconcile-billing', 'reconcile-fees', 'reconcile-usage', 'verify'],
      verificationSteps: ['Reconciliation runs return SUCCEEDED only when delegated service succeeded', 'Failed reconciliation not reported successful'],
      completionCriteria: ['No unresolved billing mismatches or they are acknowledged as diagnostic'],
      relatedServices: ['BillingModule', 'FeeReconciliationService', 'UsageService', 'FinanceModule'],
      estimatedDurationMinutes: 20,
    },
  ];

  getRunbooks(): Runbook[] {
    return this.RUNBOOKS;
  }

  getRunbook(id: string): Runbook | null {
    return this.RUNBOOKS.find((r) => r.id === id) ?? null;
  }

  getRunbookByFailureClass(failureClass: string): Runbook | null {
    return this.RUNBOOKS.find((r) => r.failureClass === failureClass) ?? null;
  }

  getRunbookForIncident(incidentType: string): Runbook | null {
    const normalized = incidentType.toUpperCase();
    // Find best match
    for (const rb of this.RUNBOOKS) {
      if (normalized.includes(rb.failureClass) || rb.failureClass.includes(normalized)) {
        return rb;
      }
    }
    // Fallback to queue failure for unknown
    return this.RUNBOOKS[0];
  }
}

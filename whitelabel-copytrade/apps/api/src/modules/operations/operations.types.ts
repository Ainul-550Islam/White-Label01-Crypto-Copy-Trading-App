/**
 * Part 18 — Institutional Operations, Reliability & Incident Control Plane
 * Canonical operational states, readiness states, dependency states, incident severities/states,
 * maintenance states, degradation levels, recovery states, operator action types, reconciliation run states,
 * and explicit transition maps.
 *
 * Every state transition must be explicitly validated.
 * All timestamps timezone-safe (UTC, ISO, persisted as Timestamptz).
 * Fingerprints and idempotency keys deterministic.
 */

import { createHash } from 'crypto';

export enum OperationalReadinessState {
  READY = 'READY',
  NOT_READY = 'NOT_READY',
  DEGRADED = 'DEGRADED',
  MAINTENANCE = 'MAINTENANCE',
  UNKNOWN = 'UNKNOWN',
}

export enum OperationalDependencyState {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
  MISCONFIGURED = 'MISCONFIGURED',
  UNKNOWN = 'UNKNOWN',
}

export enum OperationalDependencyType {
  DATABASE = 'DATABASE',
  REDIS = 'REDIS',
  QUEUE = 'QUEUE',
  CONFIGURATION = 'CONFIGURATION',
  SECURITY = 'SECURITY',
  LIVE_GATE = 'LIVE_GATE',
  EXCHANGE = 'EXCHANGE',
  COMPLIANCE = 'COMPLIANCE',
  RISK = 'RISK',
  OMS = 'OMS',
  BILLING = 'BILLING',
  NOTIFICATION = 'NOTIFICATION',
  OBSERVABILITY = 'OBSERVABILITY',
  COPY_TRADING = 'COPY_TRADING',
  RESEARCH = 'RESEARCH',
  USAGE = 'USAGE',
  SUBSCRIPTION = 'SUBSCRIPTION',
  FEE = 'FEE',
  FINANCE = 'FINANCE',
  CREDENTIAL_SOURCE = 'CREDENTIAL_SOURCE',
  VENUE_ATTESTATION = 'VENUE_ATTESTATION',
  DISTRIBUTED_LOCK = 'DISTRIBUTED_LOCK',
  SIGNED_TRANSPORT = 'SIGNED_TRANSPORT',
  IP_ALLOWLIST = 'IP_ALLOWLIST',
  DURABLE_STORE = 'DURABLE_STORE',
  EXECUTION_ENGINE = 'EXECUTION_ENGINE',
  STRATEGY_ENGINE = 'STRATEGY_ENGINE',
  MARKET_DATA = 'MARKET_DATA',
  EXTERNAL_PROVIDER = 'EXTERNAL_PROVIDER',
}

export enum OperationalIncidentSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export enum OperationalIncidentState {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  ESCALATED = 'ESCALATED',
  MITIGATING = 'MITIGATING',
  RESOLVED = 'RESOLVED',
  SUPPRESSED = 'SUPPRESSED',
  REOPENED = 'REOPENED',
}

export enum OperationalMaintenanceState {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum OperationalMaintenanceScope {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
  SERVICE = 'SERVICE',
  VENUE = 'VENUE',
  TRADING_CAPABILITY = 'TRADING_CAPABILITY',
  BILLING_CAPABILITY = 'BILLING_CAPABILITY',
}

export enum OperationalDegradationLevel {
  NORMAL = 'NORMAL',
  DEGRADED = 'DEGRADED',
  READ_ONLY = 'READ_ONLY',
  PAUSED = 'PAUSED',
  DISABLED = 'DISABLED',
}

export enum OperationalRecoveryState {
  PENDING = 'PENDING',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
  APPROVED = 'APPROVED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum OperationalActionType {
  ACKNOWLEDGE = 'ACKNOWLEDGE',
  RETRY = 'RETRY',
  RERUN_RECONCILIATION = 'RERUN_RECONCILIATION',
  ENTER_MAINTENANCE = 'ENTER_MAINTENANCE',
  EXIT_MAINTENANCE = 'EXIT_MAINTENANCE',
  ESCALATE = 'ESCALATE',
  SUPPRESS = 'SUPPRESS',
  RECOVER = 'RECOVER',
  RESOLVE = 'RESOLVE',
  REOPEN = 'REOPEN',
  CANCEL = 'CANCEL',
  DEGRADATION_CHANGE = 'DEGRADATION_CHANGE',
  TRIGGER_READINESS_CHECK = 'TRIGGER_READINESS_CHECK',
  TRIGGER_DEPENDENCY_CHECK = 'TRIGGER_DEPENDENCY_CHECK',
  TRIGGER_QUEUE_CHECK = 'TRIGGER_QUEUE_CHECK',
  TRIGGER_JOB_CHECK = 'TRIGGER_JOB_CHECK',
}

export enum OperationalActionStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  AUTHORIZED = 'AUTHORIZED',
  EXECUTING = 'EXECUTING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REQUIRES_APPROVAL = 'REQUIRES_APPROVAL',
}

export enum OperationalReconciliationRunState {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  CANCELLED = 'CANCELLED',
}

export enum OperationalReconciliationType {
  OMS_ORDER = 'OMS_ORDER',
  OMS_FILL = 'OMS_FILL',
  OMS_POSITION = 'OMS_POSITION',
  EXCHANGE_ACCOUNT = 'EXCHANGE_ACCOUNT',
  COPY_TRADING = 'COPY_TRADING',
  RISK = 'RISK',
  COMPLIANCE = 'COMPLIANCE',
  PAYMENT = 'PAYMENT',
  BILLING_FINANCE = 'BILLING_FINANCE',
  FEE = 'FEE',
  USAGE = 'USAGE',
  NOTIFICATION = 'NOTIFICATION',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export enum OperationalTriggerType {
  MANUAL = 'MANUAL',
  SCHEDULED = 'SCHEDULED',
  INCIDENT = 'INCIDENT',
  RECOVERY = 'RECOVERY',
  HEALTH_CHECK = 'HEALTH_CHECK',
  READINESS_CHECK = 'READINESS_CHECK',
  OPERATOR_ACTION = 'OPERATOR_ACTION',
  SYSTEM = 'SYSTEM',
}

export enum OperationalAuditEventType {
  READINESS_CHECK = 'READINESS_CHECK',
  DEPENDENCY_TRANSITION = 'DEPENDENCY_TRANSITION',
  INCIDENT_CREATED = 'INCIDENT_CREATED',
  INCIDENT_ACKNOWLEDGED = 'INCIDENT_ACKNOWLEDGED',
  INCIDENT_ESCALATED = 'INCIDENT_ESCALATED',
  INCIDENT_MITIGATING = 'INCIDENT_MITIGATING',
  INCIDENT_RESOLVED = 'INCIDENT_RESOLVED',
  INCIDENT_SUPPRESSED = 'INCIDENT_SUPPRESSED',
  INCIDENT_REOPENED = 'INCIDENT_REOPENED',
  INCIDENT_DEDUPLICATED = 'INCIDENT_DEDUPLICATED',
  MAINTENANCE_CREATED = 'MAINTENANCE_CREATED',
  MAINTENANCE_UPDATED = 'MAINTENANCE_UPDATED',
  MAINTENANCE_STARTED = 'MAINTENANCE_STARTED',
  MAINTENANCE_COMPLETED = 'MAINTENANCE_COMPLETED',
  MAINTENANCE_CANCELLED = 'MAINTENANCE_CANCELLED',
  RECONCILIATION_RUN_STARTED = 'RECONCILIATION_RUN_STARTED',
  RECONCILIATION_RUN_COMPLETED = 'RECONCILIATION_RUN_COMPLETED',
  RECONCILIATION_RUN_FAILED = 'RECONCILIATION_RUN_FAILED',
  RECOVERY_STARTED = 'RECOVERY_STARTED',
  RECOVERY_COMPLETED = 'RECOVERY_COMPLETED',
  RECOVERY_FAILED = 'RECOVERY_FAILED',
  OPERATOR_ACTION = 'OPERATOR_ACTION',
  DEGRADATION_CHANGED = 'DEGRADATION_CHANGED',
  QUEUE_HEALTH_CHECK = 'QUEUE_HEALTH_CHECK',
  JOB_HEALTH_CHECK = 'JOB_HEALTH_CHECK',
  ESCALATION_TRIGGERED = 'ESCALATION_TRIGGERED',
}

// Transition maps — explicit validation

export const INCIDENT_VALID_TRANSITIONS: Record<OperationalIncidentState, OperationalIncidentState[]> = {
  [OperationalIncidentState.OPEN]: [
    OperationalIncidentState.ACKNOWLEDGED,
    OperationalIncidentState.ESCALATED,
    OperationalIncidentState.MITIGATING,
    OperationalIncidentState.RESOLVED,
    OperationalIncidentState.SUPPRESSED,
  ],
  [OperationalIncidentState.ACKNOWLEDGED]: [
    OperationalIncidentState.ESCALATED,
    OperationalIncidentState.MITIGATING,
    OperationalIncidentState.RESOLVED,
    OperationalIncidentState.SUPPRESSED,
    OperationalIncidentState.REOPENED,
  ],
  [OperationalIncidentState.ESCALATED]: [
    OperationalIncidentState.ACKNOWLEDGED,
    OperationalIncidentState.MITIGATING,
    OperationalIncidentState.RESOLVED,
    OperationalIncidentState.SUPPRESSED,
  ],
  [OperationalIncidentState.MITIGATING]: [
    OperationalIncidentState.RESOLVED,
    OperationalIncidentState.ESCALATED,
    OperationalIncidentState.SUPPRESSED,
    OperationalIncidentState.REOPENED,
  ],
  [OperationalIncidentState.RESOLVED]: [OperationalIncidentState.REOPENED],
  [OperationalIncidentState.SUPPRESSED]: [OperationalIncidentState.REOPENED, OperationalIncidentState.OPEN],
  [OperationalIncidentState.REOPENED]: [
    OperationalIncidentState.ACKNOWLEDGED,
    OperationalIncidentState.ESCALATED,
    OperationalIncidentState.MITIGATING,
    OperationalIncidentState.RESOLVED,
    OperationalIncidentState.SUPPRESSED,
  ],
};

export const MAINTENANCE_VALID_TRANSITIONS: Record<OperationalMaintenanceState, OperationalMaintenanceState[]> = {
  [OperationalMaintenanceState.SCHEDULED]: [OperationalMaintenanceState.ACTIVE, OperationalMaintenanceState.CANCELLED, OperationalMaintenanceState.EXPIRED],
  [OperationalMaintenanceState.ACTIVE]: [OperationalMaintenanceState.COMPLETED, OperationalMaintenanceState.CANCELLED],
  [OperationalMaintenanceState.COMPLETED]: [],
  [OperationalMaintenanceState.CANCELLED]: [],
  [OperationalMaintenanceState.EXPIRED]: [],
};

export const RECONCILIATION_VALID_TRANSITIONS: Record<OperationalReconciliationRunState, OperationalReconciliationRunState[]> = {
  [OperationalReconciliationRunState.PENDING]: [OperationalReconciliationRunState.RUNNING, OperationalReconciliationRunState.SKIPPED, OperationalReconciliationRunState.CANCELLED],
  [OperationalReconciliationRunState.RUNNING]: [OperationalReconciliationRunState.SUCCEEDED, OperationalReconciliationRunState.FAILED, OperationalReconciliationRunState.CANCELLED],
  [OperationalReconciliationRunState.SUCCEEDED]: [],
  [OperationalReconciliationRunState.FAILED]: [OperationalReconciliationRunState.PENDING],
  [OperationalReconciliationRunState.SKIPPED]: [OperationalReconciliationRunState.PENDING],
  [OperationalReconciliationRunState.CANCELLED]: [OperationalReconciliationRunState.PENDING],
};

export const RECOVERY_VALID_TRANSITIONS: Record<OperationalRecoveryState, OperationalRecoveryState[]> = {
  [OperationalRecoveryState.PENDING]: [OperationalRecoveryState.REQUIRES_APPROVAL, OperationalRecoveryState.APPROVED, OperationalRecoveryState.RUNNING, OperationalRecoveryState.CANCELLED],
  [OperationalRecoveryState.REQUIRES_APPROVAL]: [OperationalRecoveryState.APPROVED, OperationalRecoveryState.CANCELLED],
  [OperationalRecoveryState.APPROVED]: [OperationalRecoveryState.RUNNING, OperationalRecoveryState.CANCELLED],
  [OperationalRecoveryState.RUNNING]: [OperationalRecoveryState.SUCCEEDED, OperationalRecoveryState.FAILED, OperationalRecoveryState.CANCELLED],
  [OperationalRecoveryState.SUCCEEDED]: [],
  [OperationalRecoveryState.FAILED]: [OperationalRecoveryState.PENDING, OperationalRecoveryState.REQUIRES_APPROVAL],
  [OperationalRecoveryState.CANCELLED]: [OperationalRecoveryState.PENDING],
};

export function isValidTransition<T extends string>(map: Record<T, T[]>, from: T, to: T): boolean {
  const allowed = map[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function isTerminalIncidentState(state: OperationalIncidentState): boolean {
  return state === OperationalIncidentState.RESOLVED || state === OperationalIncidentState.SUPPRESSED;
}

export function isTerminalMaintenanceState(state: OperationalMaintenanceState): boolean {
  return state === OperationalMaintenanceState.COMPLETED || state === OperationalMaintenanceState.CANCELLED || state === OperationalMaintenanceState.EXPIRED;
}

// Deterministic fingerprint: sha256 of normalized attributes
export function deterministicIncidentFingerprint(params: {
  type: string;
  severity: string;
  affectedComponent: string;
  affectedCapability?: string | null;
  tenantId?: string | null;
  scopeTarget?: string | null;
}): string {
  const normalized = [
    params.type.trim().toLowerCase(),
    params.severity.trim().toUpperCase(),
    params.affectedComponent.trim().toLowerCase(),
    (params.affectedCapability ?? '').trim().toLowerCase(),
    (params.tenantId ?? 'platform').trim().toLowerCase(),
    (params.scopeTarget ?? '').trim().toLowerCase(),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export function deterministicIdempotencyKey(params: {
  type: string;
  tenantId?: string | null;
  fingerprint?: string | null;
  scope?: string | null;
  correlationId?: string | null;
  timestampBucket?: string;
}): string {
  const bucket = params.timestampBucket ?? new Date().toISOString().slice(0, 13); // hourly bucket by default for scheduled runs
  const raw = [
    params.type,
    params.tenantId ?? 'platform',
    params.fingerprint ?? '',
    params.scope ?? '',
    params.correlationId ?? '',
    bucket,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

// Secret redaction for operational logs/incidents
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /token/i,
  /signature/i,
  /credential/i,
  /passphrase/i,
  /auth/i,
  /bearer/i,
];

export function redactSecrets<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    // If string looks like secret, mask
    if (input.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(input)) {
      return '[REDACTED]' as unknown as T;
    }
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v)) as unknown as T;
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSecretKey = SECRET_PATTERNS.some((p) => p.test(lowerKey));
      if (isSecretKey) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result as unknown as T;
  }
  return input;
}

export interface DependencyHealthResult {
  dependencyType: OperationalDependencyType;
  dependencyName: string;
  state: OperationalDependencyState;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  evidence: Record<string, unknown>;
  checkedAt: string; // ISO UTC
  isCritical: boolean;
}

export interface ReadinessResult {
  state: OperationalReadinessState;
  isReady: boolean;
  blockingReasons: string[];
  degradedComponents: string[];
  evidence: Record<string, unknown>;
  dependencyResults: DependencyHealthResult[];
  checkedAt: string;
  tenantId?: string | null;
  correlationId?: string | null;
}

export interface QueueHealthResult {
  queueName: string;
  isConnected: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: boolean;
  oldestWaitingAgeMs: number | null;
  hasStaleJobs: boolean;
  hasRetryPressure: boolean;
  evidence: Record<string, unknown>;
  checkedAt: string;
}

export interface JobHealthResult {
  jobName: string;
  queueName: string;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  failureCount: number;
  isStale: boolean;
  isRepeatedlyFailing: boolean;
  executionMetadata: Record<string, unknown>;
  checkedAt: string;
}

export interface ReconciliationSubsystemResult {
  type: OperationalReconciliationType;
  status: OperationalReconciliationRunState;
  itemsChecked: number;
  mismatchesFound: number;
  repaired: number;
  skipped: number;
  durationMs: number;
  error?: string | null;
  evidence?: Record<string, unknown>;
}

export interface OperationalMetrics {
  periodStart: string;
  periodEnd: string;
  tenantId?: string | null;
  availabilityPercent?: number | null;
  incidentCount: number;
  incidentsBySeverity: Record<string, number>;
  mttrMinutes?: number | null;
  mttaMinutes?: number | null;
  reconciliationSuccess: number;
  reconciliationFailure: number;
  queueBacklogMax: number;
  staleJobCount: number;
  dependencyHealthy: number;
  dependencyDegraded: number;
  dependencyUnavailable: number;
  recoverySuccess: number;
  recoveryFailure: number;
  operatorActionCount: number;
  operatorActionSuccess: number;
  observationCount: number;
  methodology: string;
  calculatedAt: string;
}

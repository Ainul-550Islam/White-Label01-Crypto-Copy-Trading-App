import type { ISODateString, UUID } from './common';

export enum AuditAction {
  // Auth
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN_SUCCEEDED = 'USER_LOGIN_SUCCEEDED',
  USER_LOGIN_FAILED = 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT = 'USER_LOGGED_OUT',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',
  TWO_FACTOR_FAILED = 'TWO_FACTOR_FAILED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',

  // Administration
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  TENANT_DELETED = 'TENANT_DELETED',
  TENANT_BRANDING_UPDATED = 'TENANT_BRANDING_UPDATED',
  TENANT_SETTING_UPDATED = 'TENANT_SETTING_UPDATED',
  TENANT_DOMAIN_ADDED = 'TENANT_DOMAIN_ADDED',
  TENANT_DOMAIN_REMOVED = 'TENANT_DOMAIN_REMOVED',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_SUSPENDED = 'USER_SUSPENDED',
  USER_REINSTATED = 'USER_REINSTATED',
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  FEATURE_FLAG_UPDATED = 'FEATURE_FLAG_UPDATED',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  PLAN_CREATED = 'PLAN_CREATED',
  PLAN_UPDATED = 'PLAN_UPDATED',

  // Trading domain (emitted from Part 2 onwards)
  EXCHANGE_ACCOUNT_LINKED = 'EXCHANGE_ACCOUNT_LINKED',
  EXCHANGE_ACCOUNT_UNLINKED = 'EXCHANGE_ACCOUNT_UNLINKED',
  EXCHANGE_CREDENTIAL_ROTATED = 'EXCHANGE_CREDENTIAL_ROTATED',
  COPY_SUBSCRIPTION_STARTED = 'COPY_SUBSCRIPTION_STARTED',
  COPY_SUBSCRIPTION_STOPPED = 'COPY_SUBSCRIPTION_STOPPED',
  ORDER_SUBMITTED = 'ORDER_SUBMITTED',
  RISK_LIMIT_BREACHED = 'RISK_LIMIT_BREACHED',

  // Authenticated execution (Part 5).
  //
  // Every action here changes what the platform is permitted to do with real
  // money, or closes a question about what already happened to it. They are
  // written with `recordImmediate` rather than buffered: an audit record that
  // is still in a process buffer when the process dies is not an audit record.
  ORDER_CANCEL_REQUESTED = 'ORDER_CANCEL_REQUESTED',
  ORDER_STATE_TRANSITION_REJECTED = 'ORDER_STATE_TRANSITION_REJECTED',
  EXCHANGE_ACCOUNT_ENABLED = 'EXCHANGE_ACCOUNT_ENABLED',
  EXCHANGE_ACCOUNT_DISABLED = 'EXCHANGE_ACCOUNT_DISABLED',
  EXCHANGE_ACCOUNT_VERIFIED = 'EXCHANGE_ACCOUNT_VERIFIED',
  EXCHANGE_ACCOUNT_VERIFICATION_FAILED = 'EXCHANGE_ACCOUNT_VERIFICATION_FAILED',
  LIVE_TRADING_ENABLED = 'LIVE_TRADING_ENABLED',
  LIVE_TRADING_DISABLED = 'LIVE_TRADING_DISABLED',
  PRIVATE_STREAM_ENABLED = 'PRIVATE_STREAM_ENABLED',
  PRIVATE_STREAM_DISABLED = 'PRIVATE_STREAM_DISABLED',
  KILL_SWITCH_ENGAGED = 'KILL_SWITCH_ENGAGED',
  KILL_SWITCH_RELEASED = 'KILL_SWITCH_RELEASED',
  RECONCILIATION_TRIGGERED = 'RECONCILIATION_TRIGGERED',
  RECONCILIATION_DISCREPANCY_RESOLVED = 'RECONCILIATION_DISCREPANCY_RESOLVED',
  EXECUTION_INCIDENT_RAISED = 'EXECUTION_INCIDENT_RAISED',
  EXECUTION_INCIDENT_RESOLVED = 'EXECUTION_INCIDENT_RESOLVED',
  BALANCE_REFRESH_REQUESTED = 'BALANCE_REFRESH_REQUESTED',

  // Strategy layer (Part 6).
  //
  // None of these move money. They are recorded anyway, because "who started
  // this strategy, with what parameters, and when" is the first question asked
  // after a strategy does something surprising, and reconstructing it from
  // application logs afterwards is not an answer.
  STRATEGY_INSTANCE_CREATED = 'STRATEGY_INSTANCE_CREATED',
  STRATEGY_INSTANCE_UPDATED = 'STRATEGY_INSTANCE_UPDATED',
  STRATEGY_INSTANCE_ENABLED = 'STRATEGY_INSTANCE_ENABLED',
  STRATEGY_INSTANCE_DISABLED = 'STRATEGY_INSTANCE_DISABLED',
  STRATEGY_CONFIGURATION_ACTIVATED = 'STRATEGY_CONFIGURATION_ACTIVATED',
  STRATEGY_INSTANCE_QUARANTINED = 'STRATEGY_INSTANCE_QUARANTINED',
  STRATEGY_INCIDENT_RAISED = 'STRATEGY_INCIDENT_RAISED',
  STRATEGY_INCIDENT_RESOLVED = 'STRATEGY_INCIDENT_RESOLVED',
  BACKTEST_SUBMITTED = 'BACKTEST_SUBMITTED',
  BACKTEST_CANCELLED = 'BACKTEST_CANCELLED',
  PAPER_SESSION_STARTED = 'PAPER_SESSION_STARTED',
  PAPER_SESSION_STOPPED = 'PAPER_SESSION_STOPPED',

  // Dataset layer (Part 7).
  //
  // Datasets are public market data, so none of these move money either -
  // what they protect is REPRODUCIBILITY: "who ingested this version, who
  // withdrew it, who was told it was corrupt" is the chain a disputed
  // backtest result is settled with.
  DATASET_INGESTION_REQUESTED = 'DATASET_INGESTION_REQUESTED',
  DATASET_VERSION_REGISTERED = 'DATASET_VERSION_REGISTERED',
  DATASET_VALIDATION_REQUESTED = 'DATASET_VALIDATION_REQUESTED',
  DATASET_VERSION_QUARANTINED = 'DATASET_VERSION_QUARANTINED',
  DATASET_VERSION_ARCHIVED = 'DATASET_VERSION_ARCHIVED',

  // Part 8: the risk control plane. Configuration mutations, switch
  // lifecycle transitions that operators (not the engine) performed, and
  // snapshot invalidation - the audit answer to "who changed the limits".
  // Engine-emitted breaches live in the risk_events table; an audit row
  // exists for HUMAN acts, which is why there is no RISK_LIMIT_BREACHED
  // action here and there is a RISK_KILL_SWITCH_CLEARED one.
  RISK_CONFIG_UPDATED = 'RISK_CONFIG_UPDATED',
  RISK_CONFIG_ROLLED_BACK = 'RISK_CONFIG_ROLLED_BACK',
  RISK_SNAPSHOT_INVALIDATED = 'RISK_SNAPSHOT_INVALIDATED',
  RISK_KILL_SWITCH_ACKNOWLEDGED = 'RISK_KILL_SWITCH_ACKNOWLEDGED',
  RISK_KILL_SWITCH_CLEARED = 'RISK_KILL_SWITCH_CLEARED',
  RISK_PROTECTION_CLEARED = 'RISK_PROTECTION_CLEARED',

  // Part 9 (operations). Acknowledging an alert says "a human has this";
  // force-resolving it without an observed recovery says "and we are
  // dismissing it anyway" - which is exactly why it needs its own action,
  // a typed phrase and a long reason.
  OPS_ALERT_ACKNOWLEDGED = 'OPS_ALERT_ACKNOWLEDGED',
  OPS_ALERT_FORCE_RESOLVED = 'OPS_ALERT_FORCE_RESOLVED',
  OPS_INCIDENT_STATUS_CHANGED = 'OPS_INCIDENT_STATUS_CHANGED',

  // Part 10 (reliability). Writing an SLO definition changes what future
  // evidence MEANS (which burn rate pages, which window is judged), so it is
  // audited like the human-side risk actions: typed action, versioned
  // payload, no silent in-place edit. A manual evaluation tick is also
  // audited: the console asked the platform to measure itself now, and the
  // log says so even when the verdict is HEALTHY.
  SLO_CONFIG_UPDATED = 'SLO_CONFIG_UPDATED',
  SLO_EVALUATE_REQUESTED = 'SLO_EVALUATE_REQUESTED',
}

export enum AuditActorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
  SERVICE = 'SERVICE',
  API_KEY = 'API_KEY',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  DENIED = 'DENIED',
}

export interface AuditLogDto {
  id: UUID;
  tenantId: UUID | null;
  actorType: AuditActorType;
  actorId: UUID | null;
  actorEmail: string | null;
  action: AuditAction | string;
  outcome: AuditOutcome;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: ISODateString;
}

export enum SecurityEventType {
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  NEW_DEVICE_LOGIN = 'NEW_DEVICE_LOGIN',
  IMPOSSIBLE_TRAVEL = 'IMPOSSIBLE_TRAVEL',
  BRUTE_FORCE_SUSPECTED = 'BRUTE_FORCE_SUSPECTED',
  CREDENTIAL_STUFFING_SUSPECTED = 'CREDENTIAL_STUFFING_SUSPECTED',
  TOKEN_REUSE = 'TOKEN_REUSE',
  RATE_LIMIT_ABUSE = 'RATE_LIMIT_ABUSE',
  PERMISSION_ESCALATION_ATTEMPT = 'PERMISSION_ESCALATION_ATTEMPT',
  TENANT_ISOLATION_VIOLATION = 'TENANT_ISOLATION_VIOLATION',
  ENCRYPTION_FAILURE = 'ENCRYPTION_FAILURE',
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface SecurityEventDto {
  id: UUID;
  tenantId: UUID | null;
  userId: UUID | null;
  type: SecurityEventType;
  severity: SecuritySeverity;
  description: string;
  metadata: Record<string, unknown> | null;
  ipHash: string | null;
  resolved: boolean;
  resolvedAt: ISODateString | null;
  createdAt: ISODateString;
}

import type { AlertSeverity, AlertState, ComponentStatus, IncidentLinkKind, IncidentStatus, TradingGateName } from './alert.constants';

/**
 * View types for the Part 9 operations surface. Module-local by the same
 * convention the risk module set: these are wire views, not domain objects,
 * and the enum-valued string unions live with the parity-tested catalog in
 * alert.constants.ts so one file owns the vocabulary.
 *
 * BigInt-shaped quantities (micros) render as STRINGS, per the platform-wide
 * discipline; timestamps render as ISO strings; ages as numbers where they
 * are durations rather than instants. Nothing here may carry a connection
 * string, an API key or a raw payload: the types make that the easy default
 * by having no field that could hold one.
 */

export interface OpsComponentHealthView {
  component: string;
  status: ComponentStatus;
  reason: string | null;
  latencyMicros: string | null;
  lastSuccessAt: string | null;
  capturedAt: string | null;
  ageMicros: string | null;
  stale: boolean;
  /** Already-redacted operator detail from the publisher. */
  details: Record<string, unknown>;
}

export interface OpsServiceHealthView {
  service: string;
  status: ComponentStatus;
  /** Null when the publisher mirror has not been seen at all (silence is
   *  not the same fact as HEALTHY, and the panel must be able to tell). */
  checkedAt: string | null;
  ageMicros: string | null;
  stale: boolean;
  components: OpsComponentHealthView[];
}

export interface OpsAlertView {
  id: string;
  dedupeKey: string;
  ruleId: string;
  component: string;
  scope: string | null;
  severity: AlertSeverity;
  state: AlertState;
  title: string;
  condition: string;
  message: string | null;
  observedValue: string | null;
  thresholdValue: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Human-readable duration; the raw instants are the truth. */
  durationSeconds: number;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  links: Record<string, string>;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsIncidentLinkView {
  kind: IncidentLinkKind;
  targetId: string;
  note: string | null;
}

export interface OpsIncidentView {
  id: string;
  incidentId: string;
  groupingKey: string;
  title: string;
  status: IncidentStatus;
  severity: AlertSeverity | null;
  correlationId: string | null;
  operationId: string | null;
  openedAt: string;
  closedAt: string | null;
  closeNote: string | null;
  links: OpsIncidentLinkView[];
  tenantId: string | null;
}

export interface TradingGateVerdictView {
  gate: TradingGateName;
  satisfied: boolean;
  reason: string;
  /** Which process answered for this gate: the engine mirror or the API. */
  source: 'trading-engine' | 'api' | 'none';
}

export interface TradingReadinessView {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  tradingReady: boolean;
  evaluatedAtMicros: string;
  blockingGates: TradingGateName[];
  gates: TradingGateVerdictView[];
  enginesReporting: string[];
  note: string;
}

export interface QueueStatsView {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  oldestWaitingAgeMs: number | null;
  alerting: boolean;
  critical: boolean;
}

export interface OpsOverviewSection {
  title: string;
  rows: { label: string; value: string; detail?: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }[];
}

export interface OpsOverviewView {
  status: ComponentStatus;
  tradingReady: boolean;
  alertCounts: Record<AlertSeverity, number>;
  openAlerts: number;
  acknowledgedAlerts: number;
  services: OpsServiceHealthView[];
  queues: QueueStatsView[];
  sections: OpsOverviewSection[];
  build: {
    version: string;
    environment: string;
    commit: string;
    startedAt: string;
    uptimeSeconds: number;
  };
  note: string;
}

/** The parsed wire documents the publishers own. Kept as explicit shapes
 *  (not `unknown` soup) because parse-time validation is where a corrupt
 *  mirror becomes a reportable state instead of a rendering exception. */
export interface PublishedAlertRecord {
  alertId: string;
  ruleId: string;
  severity: AlertSeverity;
  state: AlertState;
  component: string;
  scope: string | null;
  title: string;
  condition: string;
  firstSeenAtMicros: number;
  lastSeenAtMicros: number;
  occurrences: number;
  observedValue: string | null;
  thresholdValue: string | null;
  message: string | null;
  links: Record<string, string>;
  acknowledgedBy: string | null;
  acknowledgedAtMicros: number | null;
  resolvedAtMicros: number | null;
  resolution: string | null;
}

export interface PublishedAlertsDocument {
  active: PublishedAlertRecord[];
  counts: Partial<Record<AlertSeverity, number>>;
}

export interface PublishedComponentRecord {
  component: string;
  status: string;
  reason: string | null;
  latencyMicros: number | null;
  lastSuccessAtMicros: number | null;
  capturedAtMicros: number | null;
  ageMicros: number | null;
  details: Record<string, unknown>;
}

export interface PublishedHealthDocument {
  status: ComponentStatus;
  checkedAtMicros: number;
  components: PublishedComponentRecord[];
}

export interface PublishedGateVerdict {
  gate: string;
  satisfied: boolean;
  critical?: boolean;
  reason: string | null;
}

export interface PublishedReadinessDocument {
  component: string;
  gatesSatisfied: boolean;
  gates: PublishedGateVerdict[];
  note: string;
}

/** Result of one sync pass; surfaced in logs and asserted by tests, never a
 *  client-facing view. */
export interface AlertSyncResult {
  services: string[];
  inserted: number;
  folded: number;
  resolved: number;
  incidentsFolded: number;
  mirrorPresent: Record<string, boolean>;
}

/** The caller context mutations need for their audit rows. */
export interface OpsActor {
  userId: string;
  tenantId: string;
  /** Platform-scope actors may mutate tenant-null (infrastructure) rows;
   *  tenant actors may mutate only their own tenant's rows. */
  platform: boolean;
  requestId?: string | null;
  correlationId?: string | null;
}

export interface AlertMutationResult {
  accepted: true;
  alert: OpsAlertView;
}

export interface AcknowledgeAlertInput {
  reason: string;
}

export interface ForceResolveAlertInput {
  reason: string;
  confirmPhrase: string;
}

export interface ListOpsAlertsFilter {
  page: number;
  limit: number;
  state?: AlertState;
  severity?: AlertSeverity;
  component?: string;
  tenantId?: string;
}

import {
  ALERT_SEVERITIES,
  ALERT_STATES,
  COMPONENT_STATUSES,
  INCIDENT_LINK_KINDS,
  TRADING_GATES,
  type AlertSeverity,
  type AlertState,
  type ComponentStatus,
  type TradingGateName,
} from './alert.constants';
import type {
  OpsAlertView,
  OpsComponentHealthView,
  OpsIncidentView,
  PublishedAlertRecord,
  PublishedAlertsDocument,
  PublishedComponentRecord,
  PublishedGateVerdict,
  PublishedHealthDocument,
  PublishedReadinessDocument,
} from './observability.types';

/**
 * Row-to-view and wire-to-shape conversions. Two rules govern this file:
 *
 * 1. Money- and duration-shaped quantities cross the wire as STRINGS in
 *    views (BigInt micros, Decimal micros); parsing INBOUND from a publisher
 *    validates number-ness at the boundary so a corrupt mirror degrades into
 *    "unparseable, reported as such" rather than a NaN silently rendering.
 * 2. Enum fields are whitelist-checked here, never `as`-cast blindly. A
 *    publisher inventing a new severity on its side is a PARSE failure the
 *    sync job records against that service - not a widened type on ours.
 */

type OpsAlertRow = {
  id: string;
  dedupeKey: string;
  ruleId: string;
  component: string;
  scope: string | null;
  severity: string;
  state: string;
  title: string;
  condition: string;
  message: string | null;
  observedValue: string | null;
  thresholdValue: string | null;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  links: unknown;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OpsIncidentRow = {
  id: string;
  incidentId: string;
  groupingKey: string;
  title: string;
  status: string;
  severity: string | null;
  correlationId: string | null;
  operationId: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closeNote: string | null;
  tenantId: string | null;
  links?: { kind: string; targetId: string; note: string | null }[];
};

const oneOf = <T extends readonly string[]>(candidates: T, value: unknown, context: string): T[number] => {
  if (typeof value === 'string' && (candidates as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`unrecognised ${context}: ${JSON.stringify(value)}`);
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const microsToIso = (micros: number | null | undefined): string | null => {
  if (micros === null || micros === undefined) {
    return null;
  }
  return new Date(Math.round(micros / 1000)).toISOString();
};

const dateToIso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString();

export const alertRowToView = (row: OpsAlertRow): OpsAlertView => {
  const links: Record<string, string> = {};
  if (row.links !== null && typeof row.links === 'object' && !Array.isArray(row.links)) {
    for (const [key, value] of Object.entries(row.links as Record<string, unknown>)) {
      const text = asNullableString(value);
      if (text !== null) {
        links[key] = text;
      }
    }
  }
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    ruleId: row.ruleId,
    component: row.component,
    scope: row.scope,
    severity: oneOf(ALERT_SEVERITIES, row.severity, 'alert severity'),
    state: oneOf(ALERT_STATES, row.state, 'alert state'),
    title: row.title,
    condition: row.condition,
    message: row.message,
    observedValue: row.observedValue,
    thresholdValue: row.thresholdValue,
    occurrences: row.occurrences,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    durationSeconds: Math.max(0, Math.round((row.lastSeenAt.getTime() - row.firstSeenAt.getTime()) / 1000)),
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: dateToIso(row.acknowledgedAt),
    resolvedAt: dateToIso(row.resolvedAt),
    resolution: row.resolution,
    links,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

export const incidentRowToView = (row: OpsIncidentRow): OpsIncidentView => ({
  id: row.id,
  incidentId: row.incidentId,
  groupingKey: row.groupingKey,
  title: row.title,
  status: row.status === 'OPEN' || row.status === 'REVIEWING' || row.status === 'CLOSED' ? row.status : 'OPEN',
  severity:
    typeof row.severity === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(row.severity)
      ? (row.severity as AlertSeverity)
      : null,
  correlationId: row.correlationId,
  operationId: row.operationId,
  openedAt: row.openedAt.toISOString(),
  closedAt: dateToIso(row.closedAt),
  closeNote: row.closeNote,
  links: (row.links ?? []).map((link) => ({
    kind: oneOf(INCIDENT_LINK_KINDS, link.kind, 'incident link kind'),
    targetId: link.targetId,
    note: link.note,
  })),
  tenantId: row.tenantId,
});

/**
 * Inbound publisher parses. Each returns null on unparseable input; the
 * caller records that as a publisher fault (and its absence as silence),
 * never as recovery.
 */
export const parseAlertsDocument = (raw: string): PublishedAlertsDocument | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const doc = parsed as Record<string, unknown>;
    if (!Array.isArray(doc.active)) {
      return null;
    }
    const active: PublishedAlertRecord[] = [];
    for (const item of doc.active) {
      const record = parseAlertRecord(item);
      if (record === null) {
        return null;
      }
      active.push(record);
    }
    const counts: Partial<Record<AlertSeverity, number>> = {};
    if (typeof doc.counts === 'object' && doc.counts !== null) {
      for (const severity of ALERT_SEVERITIES) {
        const value = asFiniteNumber((doc.counts as Record<string, unknown>)[severity]);
        if (value !== null) {
          counts[severity] = Math.max(0, Math.round(value));
        }
      }
    }
    return { active, counts };
  } catch {
    return null;
  }
};

const parseAlertRecord = (item: unknown): PublishedAlertRecord | null => {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const value = item as Record<string, unknown>;
  const str = (key: string): string | null => asNullableString(value[key]);
  const alertId = str('alertId');
  const ruleId = str('ruleId');
  const component = str('component');
  const title = str('title');
  const condition = str('condition');
  const severityRaw = str('severity');
  const stateRaw = str('state');
  const first = asFiniteNumber(value.firstSeenAtMicros);
  const last = asFiniteNumber(value.lastSeenAtMicros);
  const occurrences = asFiniteNumber(value.occurrences);
  if (
    alertId === null ||
    ruleId === null ||
    component === null ||
    title === null ||
    condition === null ||
    severityRaw === null ||
    stateRaw === null ||
    first === null ||
    last === null ||
    occurrences === null ||
    !(ALERT_SEVERITIES as readonly string[]).includes(severityRaw) ||
    !(ALERT_STATES as readonly string[]).includes(stateRaw)
  ) {
    return null;
  }
  const links: Record<string, string> = {};
  if (typeof value.links === 'object' && value.links !== null && !Array.isArray(value.links)) {
    for (const [key, linkValue] of Object.entries(value.links as Record<string, unknown>)) {
      const text = asNullableString(linkValue);
      if (text !== null) {
        links[key] = text;
      }
    }
  }
  return {
    alertId,
    ruleId,
    severity: severityRaw as AlertSeverity,
    state: stateRaw as AlertState,
    component,
    scope: str('scope'),
    title,
    condition,
    firstSeenAtMicros: first,
    lastSeenAtMicros: last,
    occurrences: Math.max(1, Math.round(occurrences)),
    observedValue: str('observedValue'),
    thresholdValue: str('thresholdValue'),
    message: str('message'),
    links,
    acknowledgedBy: str('acknowledgedBy'),
    acknowledgedAtMicros: asFiniteNumber(value.acknowledgedAtMicros),
    resolvedAtMicros: asFiniteNumber(value.resolvedAtMicros),
    resolution: str('resolution'),
  };
};

export const parseHealthDocument = (raw: string): PublishedHealthDocument | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const doc = parsed as Record<string, unknown>;
    const statusRaw = doc.status;
    if (typeof statusRaw !== 'string' || !(COMPONENT_STATUSES as readonly string[]).includes(statusRaw)) {
      return null;
    }
    const checkedAt = asFiniteNumber(doc.checkedAtMicros);
    if (checkedAt === null || !Array.isArray(doc.components)) {
      return null;
    }
    const components: PublishedComponentRecord[] = [];
    for (const item of doc.components) {
      if (typeof item !== 'object' || item === null) {
        return null;
      }
      const component = item as Record<string, unknown>;
      const name = asNullableString(component.component);
      const componentStatus = asNullableString(component.status);
      if (
        name === null ||
        componentStatus === null ||
        !(COMPONENT_STATUSES as readonly string[]).includes(componentStatus)
      ) {
        return null;
      }
      components.push({
        component: name,
        status: componentStatus as ComponentStatus,
        reason: asNullableString(component.reason),
        latencyMicros: asFiniteNumber(component.latencyMicros),
        lastSuccessAtMicros: asFiniteNumber(component.lastSuccessAtMicros),
        capturedAtMicros: asFiniteNumber(component.capturedAtMicros),
        ageMicros: asFiniteNumber(component.ageMicros),
        details:
          typeof component.details === 'object' && component.details !== null && !Array.isArray(component.details)
            ? (component.details as Record<string, unknown>)
            : {},
      });
    }
    return { status: statusRaw as ComponentStatus, checkedAtMicros: checkedAt, components };
  } catch {
    return null;
  }
};

export const parseReadinessDocument = (raw: string): PublishedReadinessDocument | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const doc = parsed as Record<string, unknown>;
    const component = asNullableString(doc.component);
    const gatesSatisfied = doc.gatesSatisfied;
    if (component === null || typeof gatesSatisfied !== 'boolean' || !Array.isArray(doc.gates)) {
      return null;
    }
    const gates: PublishedGateVerdict[] = [];
    for (const item of doc.gates) {
      if (typeof item !== 'object' || item === null) {
        return null;
      }
      const gate = item as Record<string, unknown>;
      const name = asNullableString(gate.gate);
      if (name === null || !(TRADING_GATES as readonly string[]).includes(name) || typeof gate.satisfied !== 'boolean') {
        return null;
      }
      gates.push({
        gate: name as TradingGateName,
        satisfied: gate.satisfied,
        critical: typeof gate.critical === 'boolean' ? gate.critical : undefined,
        reason: asNullableString(gate.reason),
      });
    }
    return { component, gatesSatisfied, gates, note: asNullableString(doc.note) ?? '' };
  } catch {
    return null;
  }
};

export const componentView = (
  record: PublishedComponentRecord,
  stale: boolean,
): OpsComponentHealthView => ({
  component: record.component,
  status: record.status as ComponentStatus,
  reason: record.reason,
  latencyMicros: record.latencyMicros === null ? null : String(record.latencyMicros),
  lastSuccessAt: microsToIso(record.lastSuccessAtMicros),
  capturedAt: microsToIso(record.capturedAtMicros),
  ageMicros: record.ageMicros === null ? null : String(record.ageMicros),
  stale,
  details: record.details,
});

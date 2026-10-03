import { apiClient } from "./api-client";

/**
 * Customer-facing maintenance notice: GET /v1/operations/maintenance/current
 * (any signed-in user; the API scopes it to the caller's tenant plus
 * platform-wide windows). The banner and status page used to call
 * /operations/maintenance/current without /v1 and /operations/status, which
 * does not exist, so neither ever showed a maintenance window.
 */
export interface MaintenanceNotice {
  active: boolean;
  title: string | null;
  message: string | null;
  scope: string | null;
  isEmergency: boolean;
  startedAt: string | null;
  endsAt: string | null;
  /** Whether this window disables copying (platform-wide, tenant-wide or trading scope). */
  blocksTrading: boolean;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseMaintenanceNotice(input: unknown): MaintenanceNotice {
  const r = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const title = strOrNull(r.title);
  return {
    active: r.active === true,
    title,
    message: strOrNull(r.message) ?? title,
    scope: strOrNull(r.scope),
    isEmergency: r.isEmergency === true,
    startedAt: strOrNull(r.startedAt),
    endsAt: strOrNull(r.endsAt),
    blocksTrading: r.active === true && (typeof r.blocksTrading === "boolean" ? r.blocksTrading : true),
  };
}

export const operationsApi = {
  getCurrentMaintenance: async (): Promise<MaintenanceNotice> =>
    parseMaintenanceNotice(await apiClient.get<unknown>("/v1/operations/maintenance/current")),
};

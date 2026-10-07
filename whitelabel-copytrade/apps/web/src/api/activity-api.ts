// # NEW — Client for customer-scoped audit and activity endpoints
import { apiClient } from "./api-client";

export interface CustomerActivityItem {
  id: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  resourceType: string;
  resourceId: string | null;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerActivityPageResult {
  items: CustomerActivityItem[];
  total: number;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseCustomerActivityItem(input: unknown): CustomerActivityItem {
  const r = obj(input);
  const outcomeRaw = str(r.outcome, "SUCCESS").toUpperCase();
  const outcome: CustomerActivityItem["outcome"] =
    outcomeRaw === "FAILURE" || outcomeRaw === "DENIED" ? outcomeRaw : "SUCCESS";
  return {
    id: str(r.id),
    action: str(r.action, "ACTIVITY"),
    outcome,
    resourceType: str(r.resourceType, "Account"),
    resourceId: strOrNull(r.resourceId),
    actorId: strOrNull(r.actorId),
    metadata: obj(r.metadata),
    createdAt: str(r.createdAt, new Date(0).toISOString()),
  };
}

export const activityApi = {
  listMyActivity: async (params?: {
    action?: string;
    resourceType?: string;
    outcome?: string;
    page?: number;
    limit?: number;
  }): Promise<CustomerActivityPageResult> => {
    const raw = await apiClient.get<unknown>("/v1/audit-logs/me/activity", {
      searchParams: {
        action: params?.action || undefined,
        resourceType: params?.resourceType || undefined,
        outcome: params?.outcome || undefined,
        page: params?.page ?? 1,
        limit: params?.limit ?? 50,
      },
    });
    const root = obj(raw);
    const list = Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.data)
        ? root.data
        : Array.isArray(raw)
          ? raw
          : [];
    const pagination = obj(root.pagination);
    const total =
      typeof pagination.totalItems === "number"
        ? pagination.totalItems
        : typeof root.total === "number"
          ? root.total
          : list.length;
    return {
      items: list.map(parseCustomerActivityItem),
      total,
    };
  },
};

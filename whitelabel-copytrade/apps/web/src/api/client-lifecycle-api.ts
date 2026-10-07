import { apiClient } from "./api-client";

/**
 * Client-lifecycle reads for the customer account area (/v1/client-lifecycle).
 *
 * The pages used to call routes that do not exist (accounts/current,
 * onboarding/current, onboarding/steps, onboarding/blockers) or omitted the
 * /v1 prefix (relationships, restrictions). The API scopes every list below
 * to the caller's own client profile and accounts.
 */

type Raw = Record<string, unknown>;

export interface LifecycleAccount {
  id: string;
  displayName: string;
  accountType: string;
  state: string;
  complianceStatus: string | null;
  riskStatus: string | null;
  clientProfileId: string | null;
}

export interface Relationship {
  id: string;
  relationshipType: string;
  status: string;
  targetId: string;
}

export interface Restriction {
  id: string;
  restrictionType: string;
  reason: string;
  status: string;
  scope: string;
}

export interface OnboardingStep {
  id: string;
  stepType: string;
  status: string;
  required: boolean;
  blockingReasons: string[];
}

export interface Onboarding {
  id: string;
  state: string;
  currentStep: string | null;
  steps: OnboardingStep[];
  blockingReasons: string[];
  /** Completed required steps / required steps, 0-100 (computed: the API has no percentage). */
  progressPct: number;
}

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rows = (v: unknown): Raw[] => (Array.isArray(obj(v).data) ? (obj(v).data as unknown[]).map(obj) : []);

/** blockingReasons is JSON: strings, or objects with reason/message/code. */
export function reasonList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === "string") return item;
      const r = obj(item);
      return str(r.reason) || str(r.message) || str(r.code);
    })
    .filter((s) => s.length > 0);
}

// ClientOnboardingStepStatus: PENDING, IN_PROGRESS, COMPLETED, FAILED, BLOCKED, SKIPPED.
const DONE_STEP = new Set(["COMPLETED", "SKIPPED"]);

export function parseOnboarding(input: unknown): Onboarding | null {
  if (!input || typeof input !== "object") return null;
  const r = obj(input);
  const steps: OnboardingStep[] = (Array.isArray(r.steps) ? r.steps : []).map((raw) => {
    const s = obj(raw);
    return {
      id: str(s.id),
      stepType: str(s.stepType, "STEP"),
      status: str(s.status, "PENDING"),
      required: s.required !== false,
      blockingReasons: reasonList(s.blockingReasons),
    };
  });
  const required = steps.filter((s) => s.required);
  const done = required.filter((s) => DONE_STEP.has(s.status)).length;
  const state = str(r.state, "NOT_STARTED");
  const progressPct =
    state === "APPROVED" ? 100 : required.length === 0 ? 0 : Math.round((done / required.length) * 100);
  return {
    id: str(r.id),
    state,
    currentStep: strOrNull(r.currentStep),
    steps,
    blockingReasons: reasonList(r.blockingReasons),
    progressPct,
  };
}

export const clientLifecycleApi = {
  listAccounts: async (): Promise<LifecycleAccount[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/accounts", { searchParams: { limit: 100 } })).map((a) => ({
      id: str(a.id),
      displayName: str(a.displayName) || `${str(a.accountType, "TRADING")} account`,
      accountType: str(a.accountType, "TRADING"),
      state: str(a.state, "PENDING"),
      complianceStatus: strOrNull(a.complianceStatus),
      riskStatus: strOrNull(a.riskStatus),
      clientProfileId: strOrNull(a.clientProfileId),
    })),

  listRelationships: async (): Promise<Relationship[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/relationships")).map((r) => ({
      id: str(r.id),
      relationshipType: str(r.relationshipType, "RELATIONSHIP"),
      status: str(r.status, "ACTIVE"),
      targetId: str(r.targetId),
    })),

  listRestrictions: async (): Promise<Restriction[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/restrictions")).map((r) => ({
      id: str(r.id),
      restrictionType: str(r.restrictionType, "RESTRICTION"),
      reason: str(r.reason),
      status: str(r.status, "ACTIVE"),
      scope: str(r.scope, "ACCOUNT"),
    })),

  /** The caller's own client profile id (the API filters the list to profiles the caller may see). */
  getOwnClientProfileId: async (): Promise<string | null> => {
    const list = rows(await apiClient.get<unknown>("/v1/client-lifecycle/clients", { searchParams: { limit: 1 } }));
    return strOrNull(list[0]?.id);
  },

  /**
   * Creates the caller's own client profile when `externalIdentityRef` equals
   * the signed-in user's id (permitted by ClientLifecycleController.createClient).
   */
  createOwnClientProfile: async (data: {
    externalIdentityRef: string;
    displayName?: string;
    legalName?: string;
    email?: string;
    phone?: string;
    countryCode?: string;
  }): Promise<string> => {
    const res = obj(
      await apiClient.post<unknown>("/v1/client-lifecycle/clients", {
        clientType: "CLIENT",
        externalIdentityRef: data.externalIdentityRef,
        ...(data.displayName ? { displayName: data.displayName } : {}),
        ...(data.legalName ? { legalName: data.legalName } : {}),
        ...(data.email ? { email: data.email } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.countryCode ? { countryCode: data.countryCode } : {}),
      }),
    );
    return str(res.id);
  },

  initiateOnboarding: async (clientProfileId: string): Promise<Onboarding | null> =>
    parseOnboarding(
      await apiClient.post<unknown>(
        `/v1/client-lifecycle/clients/${encodeURIComponent(clientProfileId)}/onboarding`,
        {},
      ),
    ),

  getOnboarding: async (clientProfileId: string): Promise<Onboarding | null> =>
    parseOnboarding(
      await apiClient.get<unknown>(`/v1/client-lifecycle/clients/${encodeURIComponent(clientProfileId)}/onboarding`),
    ),
};

/**
 * Copy-trading, client-lifecycle and maintenance clients: mapping of the real
 * API records (the old types described fields the API never returned) and the
 * composed trading status / eligibility.
 */
import {
  composeTradingStatus,
  copyEligibility,
  parseStrategy,
  parseSubscription,
  parseTrader,
  permissionsAllowCopy,
} from "../api/trading-api";
import { parseOnboarding, reasonList } from "../api/client-lifecycle-api";
import { parseMaintenanceNotice } from "../api/operations-api";

const FOLLOWER_PERMISSIONS = ["copy_subscription:read", "copy_subscription:manage", "strategy:read"];
const SUPPORT_PERMISSIONS = ["support_ticket:read", "order:read"];

describe("trading-api mappers", () => {
  test("trader profile uses traderId and the API counters", () => {
    const t = parseTrader({
      traderId: "tr-1",
      displayName: "Alice",
      bio: null,
      verificationState: "VERIFIED",
      supportedVenues: ["BINANCE"],
      isPublic: true,
      isFeatured: false,
      followerCount: 12,
      totalVolume: "12500.50",
      totalTrades: 340,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect(t).toMatchObject({
      traderId: "tr-1",
      displayName: "Alice",
      verificationState: "VERIFIED",
      followerCount: 12,
      totalVolume: "12500.50",
      totalTrades: 340,
      supportedVenues: ["BINANCE"],
    });
  });

  test("strategy keeps strategyId/traderId and never needs strategyConfig", () => {
    const s = parseStrategy({ strategyId: "st-1", traderId: "tr-1", name: "Momentum", status: "PUBLISHED", type: "ALGORITHMIC" });
    expect(s).toMatchObject({ strategyId: "st-1", traderId: "tr-1", status: "PUBLISHED", type: "ALGORITHMIC" });
    expect(s).not.toHaveProperty("strategyConfig");
  });

  test("subscription maps state/allocationMode and keeps amounts as strings", () => {
    const sub = parseSubscription({
      subscriptionId: "sub-1",
      traderId: "tr-1",
      strategyId: "st-1",
      state: "ACTIVE",
      allocationMode: "FIXED",
      allocationAmount: "250.00",
      totalCopies: 4,
      failedCopies: 1,
    });
    expect(sub).toMatchObject({ subscriptionId: "sub-1", state: "ACTIVE", allocationMode: "FIXED", allocationAmount: "250.00" });
    expect(typeof sub.allocationAmount).toBe("string");
  });

  test("partial records do not throw", () => {
    expect(() => parseTrader(null)).not.toThrow();
    expect(parseStrategy(undefined).status).toBe("DRAFT");
    expect(parseSubscription({}).allocationAmount).toBe("0");
  });
});

describe("trading status and copy eligibility", () => {
  const noMaintenance = { active: false, title: null, message: null };
  const noRestrictions = { data: [], total: 0 };

  test("a follower with no restrictions and no maintenance is eligible", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, noRestrictions);
    expect(status).toMatchObject({ eligibility: "ELIGIBLE", canCopy: true, restrictions: [], maintenance: null });
    expect(copyEligibility({ status: "PUBLISHED" }, status)).toEqual({ canCopy: true, reasons: [] });
  });

  test("roles without copy_subscription:manage are NOT_PERMITTED", () => {
    expect(permissionsAllowCopy(SUPPORT_PERMISSIONS)).toBe(false);
    expect(permissionsAllowCopy(["*"])).toBe(true);
    const status = composeTradingStatus(SUPPORT_PERMISSIONS, noMaintenance, noRestrictions);
    expect(status.eligibility).toBe("NOT_PERMITTED");
    expect(copyEligibility({ status: "PUBLISHED" }, status).canCopy).toBe(false);
  });

  test("active maintenance blocks copying and carries the notice", () => {
    const status = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, title: "Upgrade", message: "Exchange upgrade", scope: "TENANT", isEmergency: true, endsAt: "2026-10-01T02:00:00.000Z" },
      noRestrictions,
    );
    expect(status.eligibility).toBe("MAINTENANCE");
    expect(status.maintenance).toMatchObject({ active: true, message: "Exchange upgrade", isEmergency: true });
    expect(copyEligibility({ status: "PUBLISHED" }, status).reasons).toEqual(["Exchange upgrade"]);
  });

  test("a window that does not block trading is shown but copying stays available", () => {
    const status = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, title: "Invoice run", message: "Billing maintenance", scope: "BILLING_CAPABILITY", blocksTrading: false },
      noRestrictions,
    );
    expect(status).toMatchObject({ eligibility: "ELIGIBLE", canCopy: true });
    expect(status.maintenance).toMatchObject({ active: true, message: "Billing maintenance", blocksTrading: false });
    const blocking = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, message: "Exchange upgrade", scope: "TRADING_CAPABILITY", blocksTrading: true },
      noRestrictions,
    );
    expect(blocking.eligibility).toBe("MAINTENANCE");
  });

  test("only ACTIVE restrictions count", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, {
      data: [
        { id: "r1", restrictionType: "NO_TRADING", reason: "KYC expired", status: "ACTIVE" },
        { id: "r2", restrictionType: "NO_WITHDRAWAL", reason: "old", status: "LIFTED" },
      ],
    });
    expect(status.eligibility).toBe("RESTRICTED");
    expect(status.restrictions).toEqual([{ type: "NO_TRADING", reason: "KYC expired" }]);
  });

  test("unpublished strategies cannot be copied, and unknown status is never eligible", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, noRestrictions);
    expect(copyEligibility({ status: "PAUSED" }, status)).toEqual({ canCopy: false, reasons: ["Strategy is paused"] });
    expect(copyEligibility({ status: "PUBLISHED" }, undefined).canCopy).toBe(false);
  });
});

describe("client-lifecycle-api onboarding", () => {
  test("progress is completed required steps over required steps", () => {
    const o = parseOnboarding({
      id: "ob-1",
      state: "IN_PROGRESS",
      currentStep: "KYC_PENDING",
      blockingReasons: ["Proof of address missing"],
      steps: [
        { id: "s1", stepType: "PROFILE_CREATED", status: "COMPLETED", required: true, blockingReasons: [] },
        { id: "s2", stepType: "KYC_PENDING", status: "BLOCKED", required: true, blockingReasons: [{ reason: "Document expired" }] },
        { id: "s3", stepType: "AGREEMENTS", status: "PENDING", required: true, blockingReasons: [] },
        { id: "s4", stepType: "NEWSLETTER", status: "PENDING", required: false, blockingReasons: [] },
      ],
    });
    expect(o).not.toBeNull();
    expect(o?.progressPct).toBe(33);
    expect(o?.blockingReasons).toEqual(["Proof of address missing"]);
    expect(o?.steps[1]?.blockingReasons).toEqual(["Document expired"]);
  });

  test("approved onboarding is 100% and a missing record is null", () => {
    expect(parseOnboarding({ id: "ob", state: "APPROVED", steps: [] })?.progressPct).toBe(100);
    expect(parseOnboarding(null)).toBeNull();
  });

  test("blocking reasons accept strings and objects", () => {
    expect(reasonList(["a", { message: "b" }, { code: "C" }, 3, null])).toEqual(["a", "b", "C"]);
    expect(reasonList(undefined)).toEqual([]);
  });
});

describe("operations-api maintenance notice", () => {
  test("maps the API shape (message falls back to title, no level field)", () => {
    expect(
      parseMaintenanceNotice({ active: true, title: "Upgrade", message: null, scope: "PLATFORM", isEmergency: false, endsAt: "2026-10-01T02:00:00.000Z" }),
    ).toEqual({
      active: true,
      title: "Upgrade",
      message: "Upgrade",
      scope: "PLATFORM",
      isEmergency: false,
      startedAt: null,
      endsAt: "2026-10-01T02:00:00.000Z",
      blocksTrading: true,
    });
    expect(parseMaintenanceNotice({ active: false }).active).toBe(false);
    expect(parseMaintenanceNotice({ active: false, blocksTrading: true }).blocksTrading).toBe(false);
    expect(parseMaintenanceNotice({ active: true, scope: "BILLING_CAPABILITY", blocksTrading: false }).blocksTrading).toBe(false);
  });
});

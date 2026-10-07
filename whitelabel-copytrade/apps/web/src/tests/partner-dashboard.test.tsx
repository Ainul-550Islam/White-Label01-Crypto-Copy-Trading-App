// # NEW — Verifies partner dashboard and referral creation flow
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartnerDashboard } from "../features/partner/partner-dashboard";
import { ReferralManager } from "../features/partner/referral-manager";

describe("PartnerDashboard & ReferralManager (GAP-35)", () => {
  test("renders partner tier, active referrals, volume, and accrued commissions", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["partner", "profile", "self"], {
      profile: {
        id: "partner-1",
        code: "IB-GOLD-01",
        name: "Alpha Capital IB",
        legalName: "Alpha Capital Ltd",
        type: "INTRODUCING_BROKER",
        state: "ACTIVE",
        tier: "GOLD_TIER",
        contactEmail: "ib@alphacapital.example",
        currency: "USDT",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      summary: {
        activeReferralsCount: 42,
        attributedTenantsCount: 12,
        referredTradingVolumeUsd: "1845000.00",
        accruedCommissionsAmount: "3690.00",
        settledCommissionsAmount: "2500.00",
        availablePayoutBalance: "1190.00",
        tierName: "GOLD_IB",
        rebateRateBps: 2500,
      },
    });
    queryClient.setQueryData(["partner", "referrals", "self"], {
      partnerId: "partner-1",
      referrals: [
        {
          id: "ref-1",
          partnerId: "partner-1",
          campaignId: "camp-q4",
          code: "ALPHAVIP",
          usesCount: 19,
          maxUses: 100,
          state: "ACTIVE",
          createdAt: "2026-09-10T00:00:00.000Z",
        },
      ],
      attributions: [],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <PartnerDashboard />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-testid="partner-dashboard"');
    expect(html).toContain("GOLD_IB");
    expect(html).toContain("1845000.00");
    expect(html).toContain("3690.00 USDT");
    expect(html).toContain("ALPHAVIP");
  });

  test("renders referral creation form and attribution funnel", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["partner", "referrals", "self"], {
      partnerId: "partner-1",
      referrals: [
        {
          id: "ref-1",
          partnerId: "partner-1",
          campaignId: "camp-q4",
          code: "ALPHAVIP",
          usesCount: 19,
          maxUses: 100,
          state: "ACTIVE",
          createdAt: "2026-09-10T00:00:00.000Z",
        },
      ],
      attributions: [
        {
          id: "attr-1",
          partnerId: "partner-1",
          tenantId: "tenant-follower-9",
          referralCode: "ALPHAVIP",
          attributionSource: "REFERRAL_LINK",
          capturedAt: "2026-09-15T12:00:00.000Z",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ReferralManager />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-testid="referral-manager"');
    expect(html).toContain('data-testid="create-referral-form"');
    expect(html).toContain("tenant-follower-9");
  });
});

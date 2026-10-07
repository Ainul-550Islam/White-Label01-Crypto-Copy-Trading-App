// # NEW — Verifies partner payout submission and status display
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartnerPayouts } from "../features/partner/partner-payouts";

describe("PartnerPayouts (GAP-37)", () => {
  test("renders partner payout request form and settlement history table", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["partner", "payouts", "self"], {
      partnerId: "partner-1",
      items: [
        {
          id: "po-101",
          partnerId: "partner-1",
          settlementId: "stl-2026-09",
          amount: "1250.00",
          currency: "USDT",
          method: "USDT_ERC20",
          state: "PAID",
          providerReference: "0x9988776655443322",
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <PartnerPayouts />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-testid="partner-payouts"');
    expect(html).toContain('data-testid="partner-payout-request-form"');
    expect(html).toContain("po-101");
    expect(html).toContain("stl-2026-09");
    expect(html).toContain("1250.00 USDT");
    expect(html).toContain("0x9988776655443322");
  });
});

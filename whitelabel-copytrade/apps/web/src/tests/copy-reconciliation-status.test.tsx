// # NEW — Verifies reconciliation status display and discrepancy warning banner
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyReconciliationStatus } from "../features/trading/copy-reconciliation-status";

describe("CopyReconciliationStatus (GAP-20)", () => {
  test("renders IN_SYNC status when no discrepancies exist", () => {
    const html = renderToStaticMarkup(
      <CopyReconciliationStatus
        summary={{
          subscriptionId: "sub-1",
          status: "IN_SYNC",
          lastCheckedAt: "2026-10-01T12:00:00.000Z",
          totalExecutions: 14,
          completedExecutions: 12,
          failedExecutions: 0,
          riskBlockedExecutions: 2,
          discrepancyCount: 0,
          discrepancies: [],
        }}
      />,
    );

    expect(html).toContain("IN_SYNC");
    expect(html).not.toContain("reconciliation-discrepancy-warning");
  });

  test("renders DISCREPANCY_DETECTED warning banner with detailed discrepancy items", () => {
    const html = renderToStaticMarkup(
      <CopyReconciliationStatus
        summary={{
          subscriptionId: "sub-1",
          status: "DISCREPANCY_DETECTED",
          lastCheckedAt: "2026-10-01T12:00:00.000Z",
          totalExecutions: 15,
          completedExecutions: 14,
          failedExecutions: 1,
          riskBlockedExecutions: 0,
          discrepancyCount: 1,
          discrepancies: [
            {
              executionId: "exec-99",
              category: "MISSING_CHILD_ORDER",
              severity: "HIGH",
              message: "Execution marked COMPLETED without linked followerOrderId",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("DISCREPANCY_DETECTED");
    expect(html).toContain("Execution marked COMPLETED without linked followerOrderId");
  });
});

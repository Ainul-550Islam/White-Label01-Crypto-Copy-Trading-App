// # NEW — Verifies customer activity log rendering and filtering
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerActivityPage } from "../features/activity/customer-activity-page";
import { activityApi } from "../api/activity-api";
import { apiClient } from "../api/api-client";

describe("CustomerActivityPage (GAP-42)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders customer audit trail and calls customer-scoped activity API", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["customer-activity", "", "", ""], {
      items: [
        {
          id: "aud-1",
          action: "COPY_SUBSCRIPTION_CREATED",
          outcome: "SUCCESS",
          resourceType: "CopySubscription",
          resourceId: "sub-100",
          actorId: "user-1",
          metadata: {},
          createdAt: "2026-10-01T10:00:00.000Z",
        },
        {
          id: "aud-2",
          action: "COPY_POLICY_UPDATED",
          outcome: "SUCCESS",
          resourceType: "CopySubscription",
          resourceId: "sub-100",
          actorId: "user-1",
          metadata: {},
          createdAt: "2026-10-01T10:05:00.000Z",
        },
      ],
      total: 2,
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CustomerActivityPage />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"customer-activity-table\"");
    expect(html).toContain("COPY_SUBSCRIPTION_CREATED");
    expect(html).toContain("COPY_POLICY_UPDATED");

    const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
      items: [{ id: "aud-1", action: "COPY_SUBSCRIPTION_CREATED", outcome: "SUCCESS", resourceType: "CopySubscription" }],
      pagination: { totalItems: 1 },
    });

    const res = await activityApi.listMyActivity({ resourceType: "CopySubscription" });
    expect(getSpy).toHaveBeenCalledWith(
      "/v1/audit-logs/me/activity",
      expect.objectContaining({
        searchParams: expect.objectContaining({ resourceType: "CopySubscription" }),
      }),
    );
    expect(res.items[0]?.action).toBe("COPY_SUBSCRIPTION_CREATED");
  });
});

/**
 * Mapping of client-lifecycle funding/withdrawal rows and accounts into the funding views.
 */
import {
  isPositiveAmount,
  mergeFundingHistory,
  toFundingAccount,
  toFundingRequest,
} from "../api/funding-api";

describe("funding-api mappers", () => {
  test("funding rows keep requested vs confirmed amounts separate", () => {
    const request = toFundingRequest(
      {
        id: "fr-1",
        accountId: "acc-1",
        state: "UNDER_REVIEW",
        requestedAmount: "250.00",
        approvedAmount: null,
        confirmedAmount: null,
        currency: "USDT",
        externalReference: "bank-ref-9",
        requestedAt: "2026-09-29T10:00:00.000Z",
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:05:00.000Z",
      },
      "DEPOSIT",
    );
    expect(request).toMatchObject({
      id: "fr-1",
      type: "DEPOSIT",
      state: "UNDER_REVIEW",
      amount: "250.00",
      confirmedAmount: null,
      currency: "USDT",
      asset: "USDT",
      externalReference: "bank-ref-9",
    });
  });

  test("withdrawal rows carry the destination and failure reason", () => {
    const request = toFundingRequest(
      {
        id: "wr-1",
        accountId: "acc-1",
        state: "FAILED",
        requestedAmount: "10",
        currency: "BTC",
        destinationAddress: "bc1qxyz",
        failureReason: "Compliance hold",
        requestedAt: "2026-09-28T00:00:00.000Z",
      },
      "WITHDRAWAL",
    );
    expect(request).toMatchObject({
      type: "WITHDRAWAL",
      destinationAddress: "bc1qxyz",
      failureReason: "Compliance hold",
      createdAt: "2026-09-28T00:00:00.000Z",
    });
  });

  test("history interleaves deposits and withdrawals newest first and sums totals", () => {
    const d = (id: string, at: string) =>
      toFundingRequest(
        {
          id,
          requestedAmount: "1",
          currency: "USD",
          state: "REQUESTED",
          requestedAt: at,
        },
        "DEPOSIT",
      );
    const w = (id: string, at: string) =>
      toFundingRequest(
        {
          id,
          requestedAmount: "1",
          currency: "USD",
          state: "REQUESTED",
          requestedAt: at,
        },
        "WITHDRAWAL",
      );
    const merged = mergeFundingHistory(
      {
        data: [
          d("d1", "2026-09-01T00:00:00Z"),
          d("d2", "2026-09-03T00:00:00Z"),
        ],
        total: 7,
      },
      { data: [w("w1", "2026-09-02T00:00:00Z")], total: 3 },
      2,
    );
    expect(merged.data.map((r) => r.id)).toEqual(["d2", "w1"]);
    expect(merged.total).toBe(10);
  });

  test("accounts get a readable label and capability flags", () => {
    expect(
      toFundingAccount({
        id: "12345678-aaaa",
        accountType: "INDIVIDUAL_TRADING",
        state: "ACTIVE",
        isFundingEnabled: true,
        isWithdrawalEnabled: false,
      }),
    ).toEqual({
      id: "12345678-aaaa",
      label: "individual trading 12345678",
      accountType: "INDIVIDUAL_TRADING",
      state: "ACTIVE",
      clientProfileId: null,
      isFundingEnabled: true,
      isWithdrawalEnabled: false,
    });
    expect(
      toFundingAccount({
        id: "a2",
        displayName: "Main account",
        accountType: "X",
        state: "SUSPENDED",
      }).label,
    ).toBe("Main account");
  });

  test("amount pre-check accepts only positive plain decimals", () => {
    for (const ok of ["1", "0.5", "100.25", "0001.0"])
      expect(isPositiveAmount(ok)).toBe(true);
    for (const bad of ["", "0", "0.00", "-1", "1e3", "1,000", " 1", "abc"])
      expect(isPositiveAmount(bad)).toBe(false);
  });
});

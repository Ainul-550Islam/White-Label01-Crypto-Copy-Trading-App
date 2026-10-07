// # NEW — Verifies venue capability matrix rendering
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExchangeCapabilities } from "../features/exchanges/exchange-capabilities";

describe("ExchangeCapabilities (GAP-21)", () => {
  test("renders full 5-venue capability matrix when no specific venue is provided", () => {
    const html = renderToStaticMarkup(<ExchangeCapabilities />);
    expect(html).toContain("data-testid=\"exchange-capabilities-matrix\"");
    expect(html).toContain("Binance");
    expect(html).toContain("Bybit V5");
    expect(html).toContain("OKX V5");
    expect(html).toContain("Kraken");
    expect(html).toContain("Coinbase Advanced Trade");
    expect(html).toContain("Passphrase Required");
  });

  test("renders single venue capability details and execution posture badge when venue is specified", () => {
    const html = renderToStaticMarkup(
      <ExchangeCapabilities
        venue="BYBIT"
        discoveredCapabilities={["SPOT", "PERPETUALS", "ORDERS"]}
        tradingEnabled={true}
        environment="LIVE"
      />,
    );
    expect(html).toContain("Bybit V5");
    expect(html).toContain("LIVE EXECUTION READY");
    expect(html).toContain("SPOT, PERPETUALS, ORDERS");
  });
});

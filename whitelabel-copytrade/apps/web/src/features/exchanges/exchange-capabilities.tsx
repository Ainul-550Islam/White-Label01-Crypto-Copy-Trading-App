// # NEW — Renders venue capability matrix (Spot/Futures/Margin, order types, live vs paper readiness, IP whitelist requirements)
"use client";
import type { JSX } from 'react';

import React from "react";
import { StatusBadge } from "@/components/status-badge";

export interface VenueCapabilityDefinition {
  venue: string;
  displayName: string;
  spotSupported: boolean;
  marginSupported: boolean;
  futuresSupported: boolean;
  perpetualsSupported: boolean;
  supportedOrderTypes: string[];
  liveReadSupported: boolean;
  liveOrderExecutionGated: boolean;
  paperSimulationSupported: boolean;
  requiresPassphrase: boolean;
  ipAllowlistRecommended: boolean;
  withdrawalPermissionMustBeDisabled: boolean;
  authenticationModel: string;
}

export const WEB_VENUE_CAPABILITIES: Record<string, VenueCapabilityDefinition> = {
  BINANCE: {
    venue: "BINANCE",
    displayName: "Binance",
    spotSupported: true,
    marginSupported: true,
    futuresSupported: true,
    perpetualsSupported: true,
    supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "TAKE_PROFIT", "LIMIT_MAKER"],
    liveReadSupported: true,
    liveOrderExecutionGated: true,
    paperSimulationSupported: true,
    requiresPassphrase: false,
    ipAllowlistRecommended: true,
    withdrawalPermissionMustBeDisabled: true,
    authenticationModel: "HMAC_SHA256",
  },
  BYBIT: {
    venue: "BYBIT",
    displayName: "Bybit V5",
    spotSupported: true,
    marginSupported: false,
    futuresSupported: true,
    perpetualsSupported: true,
    supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
    liveReadSupported: true,
    liveOrderExecutionGated: true,
    paperSimulationSupported: true,
    requiresPassphrase: false,
    ipAllowlistRecommended: true,
    withdrawalPermissionMustBeDisabled: true,
    authenticationModel: "HMAC_SHA256",
  },
  OKX: {
    venue: "OKX",
    displayName: "OKX V5",
    spotSupported: true,
    marginSupported: true,
    futuresSupported: true,
    perpetualsSupported: true,
    supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
    liveReadSupported: true,
    liveOrderExecutionGated: true,
    paperSimulationSupported: true,
    requiresPassphrase: true,
    ipAllowlistRecommended: true,
    withdrawalPermissionMustBeDisabled: true,
    authenticationModel: "HMAC_SHA256_PASSPHRASE",
  },
  KRAKEN: {
    venue: "KRAKEN",
    displayName: "Kraken",
    spotSupported: true,
    marginSupported: true,
    futuresSupported: false,
    perpetualsSupported: false,
    supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
    liveReadSupported: true,
    liveOrderExecutionGated: true,
    paperSimulationSupported: true,
    requiresPassphrase: false,
    ipAllowlistRecommended: true,
    withdrawalPermissionMustBeDisabled: true,
    authenticationModel: "HMAC_SHA512_NONCE",
  },
  COINBASE: {
    venue: "COINBASE",
    displayName: "Coinbase Advanced Trade",
    spotSupported: true,
    marginSupported: false,
    futuresSupported: false,
    perpetualsSupported: true,
    supportedOrderTypes: ["MARKET", "LIMIT", "STOP_LIMIT"],
    liveReadSupported: true,
    liveOrderExecutionGated: true,
    paperSimulationSupported: true,
    requiresPassphrase: false,
    ipAllowlistRecommended: true,
    withdrawalPermissionMustBeDisabled: true,
    authenticationModel: "CDP_JWT_ES256_ED25519",
  },
};

export interface ExchangeCapabilitiesProps {
  venue?: string;
  discoveredCapabilities?: string[];
  tradingEnabled?: boolean;
  environment?: string;
}

export function ExchangeCapabilities({
  venue,
  discoveredCapabilities = [],
  tradingEnabled = false,
  environment = "SANDBOX",
}: ExchangeCapabilitiesProps): JSX.Element {
  const venueKey = (venue || "").toUpperCase();
  const selectedVenueCap = WEB_VENUE_CAPABILITIES[venueKey];
  const rows = selectedVenueCap
    ? [selectedVenueCap]
    : Object.values(WEB_VENUE_CAPABILITIES);

  return (
    <div
      className="space-y-4 rounded border bg-card p-4 text-xs"
      data-testid="exchange-capabilities-matrix"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            Exchange Venue Capability & Safety Matrix
          </h3>
          <p className="text-muted">
            Authoritative market coverage, order types, IP allowlist policy, and live vs paper execution posture.
          </p>
        </div>
        {venue && (
          <div className="flex items-center gap-2">
            <StatusBadge status={environment} />
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                tradingEnabled && environment === "LIVE"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {tradingEnabled && environment === "LIVE"
                ? "LIVE EXECUTION READY"
                : "PAPER / READ-ONLY SAFE MODE"}
            </span>
          </div>
        )}
      </div>

      {discoveredCapabilities.length > 0 && (
        <div className="rounded bg-slate-50 p-2.5">
          <span className="font-semibold">Account Discovered Permissions: </span>
          <span className="font-mono">{discoveredCapabilities.join(", ")}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs" data-testid="venue-capability-table">
          <thead>
            <tr className="border-b bg-slate-50 text-muted">
              <th className="p-2.5">Venue</th>
              <th className="p-2.5">Markets (Spot / Margin / Perps)</th>
              <th className="p-2.5">Order Types</th>
              <th className="p-2.5">Auth & Passphrase</th>
              <th className="p-2.5">IP Allowlist & Withdrawal Safety</th>
              <th className="p-2.5">Execution Gate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((cap) => (
              <tr key={cap.venue}>
                <td className="p-2.5 font-semibold">{cap.displayName}</td>
                <td className="p-2.5">
                  <span className="mr-1.5">Spot: {cap.spotSupported ? "Yes" : "No"}</span>
                  <span className="mr-1.5">| Margin: {cap.marginSupported ? "Yes" : "No"}</span>
                  <span>| Perps: {cap.perpetualsSupported ? "Yes" : "No"}</span>
                </td>
                <td className="p-2.5 font-mono">{cap.supportedOrderTypes.join(", ")}</td>
                <td className="p-2.5">
                  {cap.authenticationModel}
                  {cap.requiresPassphrase ? " (Passphrase Required)" : ""}
                </td>
                <td className="p-2.5">
                  IP Allowlist Recommended | Withdrawals Must Be Disabled
                </td>
                <td className="p-2.5">
                  Live Read + Paper Sim + Explicit Live Gate
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

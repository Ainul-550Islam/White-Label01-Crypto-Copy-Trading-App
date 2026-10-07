// # Responsibility: reads caller- or trader-profile-owner-scoped exposure without constructing or converting financial values in the browser.

import { apiClient } from './api-client';

export type CustomerExposureValueState = 'CURRENT' | 'STALE' | 'UNKNOWN';
export type CustomerExposureState = CustomerExposureValueState | 'EMPTY';
export type CustomerExposureScope =
  | 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS'
  | 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';

export interface CustomerExposureLine {
  symbol: string;
  venue: string;
  marketType: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  longQuantity: string | null;
  shortQuantity: string | null;
  netQuantity: string | null;
  longPositionNotional: string | null;
  shortPositionNotional: string | null;
  grossPositionNotional: string | null;
  netPositionNotional: string | null;
  openOrderCommitment: string | null;
  totalNotional: string | null;
  openOrderCount: number;
  openOrderCommitmentBasis: 'ORDER_PRICE' | 'MARKET_DATA_1M_CANDLE_CLOSE' | 'MIXED' | null;
  price: string | null;
  priceSource: 'MARKET_DATA_1M_CANDLE_CLOSE' | null;
  priceTimestamp: string | null;
  positionState: CustomerExposureValueState | 'NO_POSITION';
  openOrderState: CustomerExposureValueState | 'NO_OPEN_ORDERS';
  state: CustomerExposureValueState;
}

export interface CustomerExposureQuoteTotal {
  quoteAsset: string;
  longPositionNotional: string | null;
  shortPositionNotional: string | null;
  grossPositionNotional: string | null;
  openOrderCommitment: string | null;
  totalNotional: string | null;
  state: CustomerExposureValueState;
}

export interface CustomerExposureView {
  tenantId: string;
  traderId: string | null;
  asOf: string;
  state: CustomerExposureState;
  eligibleAccountCount: number;
  lines: CustomerExposureLine[];
  totalsByQuoteAsset: CustomerExposureQuoteTotal[];
  staleSymbols: string[];
  unknownSymbols: string[];
  dataScope: CustomerExposureScope;
  simulatedRecordsIncluded: false;
  cashBalancesIncluded: false;
  currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION';
  priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS';
  notice: string;
}

export interface TraderExposureView extends Omit<CustomerExposureView, 'traderId' | 'dataScope'> {
  traderId: string;
  dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS';
}

export const customerExposureApi = {
  getMyExposure(): Promise<CustomerExposureView> {
    return apiClient.get<CustomerExposureView>('/v1/risk-management/my-exposure');
  },
  getTraderExposure(traderId: string): Promise<TraderExposureView> {
    return apiClient.get<TraderExposureView>(
      `/v1/risk-management/traders/${encodeURIComponent(traderId)}/exposure`,
    );
  },
};

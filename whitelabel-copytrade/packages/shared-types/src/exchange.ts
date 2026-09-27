/**
 * Exchange integration contracts.
 *
 * The platform is strictly non-custodial: followers connect their own exchange
 * accounts using trade-enabled, withdrawal-disabled API keys. Secrets are
 * encrypted at rest with envelope encryption and are never returned by the API.
 */
export enum ExchangeId {
  BINANCE = 'binance',
  BYBIT = 'bybit',
  OKX = 'okx',
  KRAKEN = 'kraken',
}

export enum ExchangeMarketType {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES_USDT = 'FUTURES_USDT',
  FUTURES_COIN = 'FUTURES_COIN',
}

export enum ExchangeCredentialStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  ACTIVE = 'ACTIVE',
  INVALID = 'INVALID',
  REVOKED = 'REVOKED',
  PERMISSION_INSUFFICIENT = 'PERMISSION_INSUFFICIENT',
  WITHDRAWAL_ENABLED_REJECTED = 'WITHDRAWAL_ENABLED_REJECTED',
}

export interface ExchangeCapabilities {
  id: ExchangeId;
  displayName: string;
  marketTypes: ExchangeMarketType[];
  supportsUserDataStream: boolean;
  supportsWebhooks: boolean;
  requiresPassphrase: boolean;
  supportsSandbox: boolean;
  maxLeverage: number;
  weightLimitPerMinute: number;
}

export const EXCHANGE_CAPABILITIES: Readonly<Record<ExchangeId, ExchangeCapabilities>> =
  Object.freeze({
    [ExchangeId.BINANCE]: {
      id: ExchangeId.BINANCE,
      displayName: 'Binance',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.MARGIN,
        ExchangeMarketType.FUTURES_USDT,
        ExchangeMarketType.FUTURES_COIN,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: true,
      maxLeverage: 125,
      weightLimitPerMinute: 6000,
    },
    [ExchangeId.BYBIT]: {
      id: ExchangeId.BYBIT,
      displayName: 'Bybit',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.FUTURES_USDT,
        ExchangeMarketType.FUTURES_COIN,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: true,
      maxLeverage: 100,
      weightLimitPerMinute: 600,
    },
    [ExchangeId.OKX]: {
      id: ExchangeId.OKX,
      displayName: 'OKX',
      marketTypes: [
        ExchangeMarketType.SPOT,
        ExchangeMarketType.MARGIN,
        ExchangeMarketType.FUTURES_USDT,
      ],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: true,
      supportsSandbox: true,
      maxLeverage: 125,
      weightLimitPerMinute: 1200,
    },
    [ExchangeId.KRAKEN]: {
      id: ExchangeId.KRAKEN,
      displayName: 'Kraken',
      marketTypes: [ExchangeMarketType.SPOT, ExchangeMarketType.FUTURES_USDT],
      supportsUserDataStream: true,
      supportsWebhooks: false,
      requiresPassphrase: false,
      supportsSandbox: false,
      maxLeverage: 50,
      weightLimitPerMinute: 900,
    },
  });

/**
 * Safe projection of an exchange connection. Deliberately contains no secret
 * material: only a masked key fragment for user recognition.
 */
export interface ExchangeAccountPublicDto {
  id: string;
  tenantId: string;
  userId: string;
  exchange: ExchangeId;
  label: string;
  marketType: ExchangeMarketType;
  apiKeyMasked: string;
  status: ExchangeCredentialStatus;
  isSandbox: boolean;
  permissions: {
    canRead: boolean;
    canTrade: boolean;
    canWithdraw: boolean;
  };
  lastValidatedAt: string | null;
  createdAt: string;
}

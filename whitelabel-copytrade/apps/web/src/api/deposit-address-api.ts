import { apiClient } from './api-client';

export interface DepositAssetOption {
  assetId: string;
  networkId: string;
  currency: string;
  networkName: string;
  tokenStandard: string | null;
  contractAddress: string | null;
}
export interface DepositAddress {
  fundingRequestId: string;
  accountId: string;
  assetId: string;
  networkId: string;
  currency: string;
  address: string;
  status: 'ADDRESS_VERIFIED';
  settlementStatus: 'NOT_CONFIRMED';
  monitoringStatus: 'NOT_CONNECTED';
  verifiedAt: string;
}
export interface DepositObservation {
  status: 'OBSERVED';
  fundingRequestId: string;
  assetId: string;
  currency: string;
  transactionHash: string;
  destinationAddress: string;
  amount: string;
  rawUnits: string;
  confirmationCount: number;
  logIndex: number | null;
  amountEvidence: 'PROVIDER_REPORTED' | 'TRANSFER_LOG_MATCHED';
  settlementStatus: 'NOT_CONFIRMED';
  monitoringStatus: 'LOOKUP_ONLY';
  complianceStatus: 'NOT_EVALUATED';
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address = /^0x[0-9a-f]{40}$/i;
const transactionHashPattern = /^0x[0-9a-f]{64}$/i;

function encodeRequestId(requestId: string): string {
  if (!uuid.test(requestId)) throw new Error('Invalid request identity');
  return encodeURIComponent(requestId);
}
function path(requestId: string): string {
  return `/v1/client-lifecycle/funding/${encodeRequestId(requestId)}/deposit-address`;
}
function option(value: unknown): DepositAssetOption {
  if (!value || typeof value !== 'object') throw new Error('Invalid deposit option');
  const v = value as Record<string, unknown>;
  if (typeof v.assetId !== 'string' || !identifier.test(v.assetId) || v.networkId !== 'ethereum' ||
      typeof v.currency !== 'string' || !/^[A-Z0-9]{2,10}$/.test(v.currency) ||
      typeof v.networkName !== 'string' || !v.networkName || v.networkName.length > 128 ||
      !(v.tokenStandard === null || v.tokenStandard === 'ERC20') ||
      !(v.contractAddress === null || (typeof v.contractAddress === 'string' && address.test(v.contractAddress))) ||
      (v.tokenStandard === 'ERC20') !== (v.contractAddress !== null)) throw new Error('Invalid deposit option');
  return v as unknown as DepositAssetOption;
}
function view(value: unknown, requestId: string, choice: DepositAssetOption): DepositAddress {
  if (!value || typeof value !== 'object') throw new Error('Invalid deposit address');
  const v = value as Record<string, unknown>;
  if (v.fundingRequestId !== requestId || v.assetId !== choice.assetId || v.networkId !== choice.networkId ||
      v.currency !== choice.currency || typeof v.accountId !== 'string' || !uuid.test(v.accountId) ||
      typeof v.address !== 'string' || !address.test(v.address) || /^0x0{40}$/i.test(v.address) ||
      v.status !== 'ADDRESS_VERIFIED' || v.settlementStatus !== 'NOT_CONFIRMED' || v.monitoringStatus !== 'NOT_CONNECTED' ||
      typeof v.verifiedAt !== 'string' || !Number.isFinite(Date.parse(v.verifiedAt))) throw new Error('Invalid deposit address');
  return v as unknown as DepositAddress;
}
function observation(value: unknown, requestId: string, choice: DepositAssetOption,
  expectedAddress: string, expectedHash: string): DepositObservation {
  if (!value || typeof value !== 'object') throw new Error('Invalid transfer observation');
  const v = value as Record<string, unknown>;
  if (v.status !== 'OBSERVED' || v.fundingRequestId !== requestId || v.assetId !== choice.assetId || v.currency !== choice.currency ||
      typeof v.destinationAddress !== 'string' || !address.test(v.destinationAddress) ||
      v.destinationAddress.toLowerCase() !== expectedAddress.toLowerCase() ||
      typeof v.transactionHash !== 'string' || !transactionHashPattern.test(v.transactionHash) ||
      v.transactionHash.toLowerCase() !== expectedHash.toLowerCase() ||
      typeof v.amount !== 'string' || !/^(?:0|[1-9]\d{0,39})(?:\.\d{1,36})?$/.test(v.amount) || !/[1-9]/.test(v.amount) ||
      typeof v.rawUnits !== 'string' || !/^[1-9]\d{0,77}$/.test(v.rawUnits) ||
      !Number.isSafeInteger(v.confirmationCount) || (v.confirmationCount as number) < 1 ||
      !((v.amountEvidence === 'PROVIDER_REPORTED' && v.logIndex === null) ||
        (v.amountEvidence === 'TRANSFER_LOG_MATCHED' && Number.isSafeInteger(v.logIndex) && (v.logIndex as number) >= 0)) ||
      v.settlementStatus !== 'NOT_CONFIRMED' || v.monitoringStatus !== 'LOOKUP_ONLY' || v.complianceStatus !== 'NOT_EVALUATED') {
    throw new Error('Invalid transfer observation');
  }
  return v as unknown as DepositObservation;
}
export const depositAddressApi = {
  async listAssets(requestId: string): Promise<DepositAssetOption[]> {
    const value = await apiClient.get<unknown>(`/v1/client-lifecycle/funding/${encodeRequestId(requestId)}/deposit-address/assets`);
    if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid deposit options');
    return value.map(option);
  },
  async get(requestId: string, choice: DepositAssetOption): Promise<DepositAddress> {
    const value = await apiClient.get<unknown>(path(requestId), { searchParams: { assetId: choice.assetId, networkId: choice.networkId } });
    return view(value, requestId, choice);
  },
  async observeTransfer(requestId: string, choice: DepositAssetOption, expectedAddress: string, transactionHash: string): Promise<DepositObservation> {
    if (!address.test(expectedAddress) || !transactionHashPattern.test(transactionHash)) throw new Error('Invalid transfer identity');
    const value = await apiClient.get<unknown>(`/v1/client-lifecycle/funding/${encodeRequestId(requestId)}/deposit-address/transactions/${encodeURIComponent(transactionHash)}`,
      { searchParams: { assetId: choice.assetId, networkId: choice.networkId } });
    return observation(value, requestId, choice, expectedAddress, transactionHash);
  },
  async issue(requestId: string, choice: DepositAssetOption, idempotencyKey: string): Promise<DepositAddress> {
    const value = await apiClient.post<unknown>(path(requestId), { assetId: choice.assetId, networkId: choice.networkId }, { idempotencyKey });
    return view(value, requestId, choice);
  },
};

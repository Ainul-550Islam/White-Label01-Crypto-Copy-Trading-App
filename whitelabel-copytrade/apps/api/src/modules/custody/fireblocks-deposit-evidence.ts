import { FireblocksUnavailable, type FireblocksEvmReceipt, type FireblocksFinalTransaction } from './fireblocks-vault.client';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const EXTERNAL_SOURCE_TYPES = new Set(['UNKNOWN', 'EXTERNAL_WALLET', 'ONE_TIME_ADDRESS', 'WHITELISTED_ADDRESS']);

/** The binding must be loaded from an eligible, verified issuance and rechecked
 * against the provider's asset and vault; it is never customer input. */
export interface IssuedEvmDepositBinding {
  networkId: string;
  chainId: string;
  providerAssetId: string;
  providerNativeAssetId: string;
  vaultId: string;
  customerRefId: string;
  address: string;
  decimals: number;
  isNative: boolean;
  contractAddress: string | null;
}

/** Observation is not a compliance decision, settlement, or spendable credit. */
export interface ObservedEvmDeposit {
  status: 'OBSERVED';
  transactionId: string;
  transactionHash: string;
  destinationAddress: string;
  sourceAddress: string;
  providerAssetId: string;
  amount: string;
  rawUnits: string;
  blockHash: string;
  blockNumber: string;
  confirmationCount: number;
  /** Null for native transfers. For ERC-20 this is the actual receipt log index. */
  logIndex: number | null;
  amountEvidence: 'PROVIDER_REPORTED' | 'TRANSFER_LOG_MATCHED';
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function exactUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 ||
      !/^(?:0|[1-9]\d{0,39})(?:\.\d{1,36})?$/.test(amount)) {
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }
  const [whole, fraction = ''] = amount.split('.');
  // Trailing zeros beyond the token's precision are harmless, but a nonzero
  // sub-unit cannot be represented and must never be rounded or truncated.
  if (fraction.slice(decimals).replace(/0/g, '') !== '') throw new FireblocksUnavailable('INVALID_RESPONSE');
  const units = BigInt(whole!) * (10n ** BigInt(decimals)) + BigInt((fraction.slice(0, decimals).padEnd(decimals, '0')) || '0');
  if (units <= 0n || units >= (1n << 256n)) throw new FireblocksUnavailable('INVALID_RESPONSE');
  return units;
}

function topicAddress(topic: string): string | null {
  return /^0x0{24}[0-9a-f]{40}$/i.test(topic) ? `0x${topic.slice(26)}` : null;
}

/**
 * Match independently fetched Fireblocks transaction details and receipt to
 * one locally verified Ethereum issuance. This intentionally only emits an
 * observation. Compliance, finality/reorg policy, ownership at commit, and an
 * atomic customer-liability credit remain separate mandatory gates.
 */
export function matchIssuedEvmDeposit(
  binding: IssuedEvmDepositBinding,
  transaction: FireblocksFinalTransaction,
  receipt: FireblocksEvmReceipt,
): ObservedEvmDeposit {
  const invalid = () => { throw new FireblocksUnavailable('INVALID_RESPONSE'); };
  if (binding.networkId !== 'ethereum' || binding.chainId !== '1' || binding.providerNativeAssetId !== 'ETH' ||
      !IDENTIFIER.test(binding.providerAssetId) || !/^(?:0|[1-9]\d{0,29})$/.test(binding.vaultId) ||
      !binding.customerRefId || !ADDRESS.test(binding.address) ||
      transaction.assetId !== binding.providerAssetId || transaction.destinationVaultId !== binding.vaultId ||
      !ADDRESS.test(transaction.destinationAddress) || !sameHex(transaction.destinationAddress, binding.address) ||
      transaction.destinationTag !== null || !EXTERNAL_SOURCE_TYPES.has(transaction.sourceType) ||
      !transaction.sourceAddress || !ADDRESS.test(transaction.sourceAddress) || sameHex(transaction.sourceAddress, binding.address) ||
      (transaction.customerRefId !== null && transaction.customerRefId !== binding.customerRefId) ||
      !HASH.test(transaction.transactionHash) || !sameHex(transaction.transactionHash, receipt.transactionHash) ||
      !HASH.test(transaction.blockHash) || !sameHex(transaction.blockHash, receipt.blockHash) ||
      !/^\d+$/.test(transaction.blockNumber) || !/^\d+$/.test(receipt.blockNumber) ||
      BigInt(transaction.blockNumber) !== BigInt(receipt.blockNumber) ||
      !Number.isSafeInteger(transaction.confirmationCount) || transaction.confirmationCount < 1) {
    return invalid();
  }
  const units = exactUnits(transaction.netAmount, binding.decimals);
  let logIndex: number | null = null;
  let amountEvidence: ObservedEvmDeposit['amountEvidence'];
  if (binding.isNative) {
    if (binding.providerAssetId !== 'ETH' || binding.decimals !== 18 || binding.contractAddress !== null ||
        !receipt.to || !sameHex(receipt.to, binding.address) || !sameHex(receipt.from, transaction.sourceAddress)) return invalid();
    // The receipt does not include native transaction value. The exact amount
    // here is authenticated provider data, not an independently verified value.
    amountEvidence = 'PROVIDER_REPORTED';
  } else {
    if (binding.providerAssetId === 'ETH' || !binding.contractAddress || !ADDRESS.test(binding.contractAddress)) return invalid();
    const matches = receipt.logs.filter((log) => {
      if (!sameHex(log.address, binding.contractAddress!) || log.topics.length !== 3 ||
          !sameHex(log.topics[0]!, TRANSFER_TOPIC) || !/^0x[0-9a-f]{64}$/i.test(log.data)) return false;
      const from = topicAddress(log.topics[1]!);
      const to = topicAddress(log.topics[2]!);
      return !!from && !!to && sameHex(from, transaction.sourceAddress!) && sameHex(to, binding.address) && BigInt(log.data) === units;
    });
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0]!.logIndex) || matches[0]!.logIndex < 0) {
      throw new FireblocksUnavailable('AMBIGUOUS');
    }
    logIndex = matches[0]!.logIndex;
    amountEvidence = 'TRANSFER_LOG_MATCHED';
  }
  return {
    status: 'OBSERVED', transactionId: transaction.id, transactionHash: transaction.transactionHash.toLowerCase(),
    destinationAddress: binding.address.toLowerCase(), sourceAddress: transaction.sourceAddress.toLowerCase(),
    providerAssetId: binding.providerAssetId, amount: transaction.netAmount, rawUnits: units.toString(),
    blockHash: receipt.blockHash.toLowerCase(), blockNumber: receipt.blockNumber,
    confirmationCount: transaction.confirmationCount, logIndex, amountEvidence,
  };
}

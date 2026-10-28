import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FireblocksUnavailable, FireblocksVaultClient, type FireblocksAsset, type FireblocksVault } from '../custody/fireblocks-vault.client';
import { matchIssuedEvmDeposit, type ObservedEvmDeposit } from '../custody/fireblocks-deposit-evidence';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTATION_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
// Fireblocks remembers write idempotency keys for 24 hours. We stop trying
// writes early, leaving enough margin for clock skew and network latency.
const SAFE_RETRY_MS = 20 * 60 * 60 * 1000;

interface IssuanceRow {
  id: string;
  tenant_id: string;
  funding_request_id: string;
  account_id: string;
  client_profile_id: string | null;
  asset_id: string;
  network_id: string;
  provider_asset_id: string;
  provider_native_asset_id: string;
  provider_credential_fingerprint: string;
  vault_name: string;
  provider_customer_ref: string;
  vault_id: string | null;
  address: string | null;
  state: 'PENDING' | 'VERIFIED' | 'MANUAL_REVIEW';
  attempt_started_at: Date;
  verified_at: Date | null;
}

interface AssetEvidence {
  id: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  contractAddress: string | null;
  tokenStandard: string | null;
  providerAssetId: string;
  providerNativeAssetId: string;
}

interface Eligibility {
  accountId: string;
  clientProfileId: string | null;
  asset: AssetEvidence;
}

export interface CustomerDepositAssetOption {
  assetId: string;
  networkId: string;
  currency: string;
  networkName: string;
  tokenStandard: string | null;
  contractAddress: string | null;
}

export interface CustomerDepositObservationView extends ObservedEvmDeposit {
  fundingRequestId: string;
  assetId: string;
  currency: string;
  settlementStatus: 'NOT_CONFIRMED';
  monitoringStatus: 'LOOKUP_ONLY';
  complianceStatus: 'NOT_EVALUATED';
}

export interface CustomerDepositAddressView {
  fundingRequestId: string;
  accountId: string;
  assetId: string;
  currency: string;
  networkId: string;
  address: string;
  /** Issuance proves neither a transfer nor an account credit. */
  status: 'ADDRESS_VERIFIED';
  settlementStatus: 'NOT_CONFIRMED';
  monitoringStatus: 'NOT_CONNECTED';
  verifiedAt: string;
}

/** Configuration is read only in the backend; the credentials never leave it. */
@Injectable()
export class CustomerDepositProviderFactory {
  create(): FireblocksVaultClient {
    return new FireblocksVaultClient(
      process.env.FIREBLOCKS_API_KEY ?? '',
      process.env.FIREBLOCKS_SECRET_KEY ?? '',
      process.env.FIREBLOCKS_BASE_URL ?? '',
    );
  }
}

/**
 * A customer-owned funding request gets a dedicated provider vault. The
 * provider, asset metadata and vault identity are independently re-read before
 * any address is returned. Local records are an idempotency/reconciliation
 * ledger, not proof of an observed deposit or available balance.
 *
 * Writes to the remote provider cannot participate in a database transaction.
 * The intent is committed first, remote calls use stable provider idempotency
 * keys, a fenced lease serializes local completion, and an uncertain request
 * past Fireblocks' retention window is sent to manual review, never recreated.
 */
@Injectable()
export class CustomerDepositAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: CustomerDepositProviderFactory,
  ) {}

  /** Configured candidates only: actual provider identity is checked on issue. */
  async listAssets(input: { tenantId: string; userId: string; fundingRequestId: string }): Promise<CustomerDepositAssetOption[]> {
    if (!UUID.test(input.tenantId) || !UUID.test(input.userId) || !UUID.test(input.fundingRequestId)) {
      throw new UnprocessableEntityException('Invalid deposit address request.');
    }
    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const { request } = await this.requireOwnedFunding(tx, input);
      const network = await tx.custodyNetwork.findFirst({ where: { networkId: 'ethereum', status: 'ACTIVE' } });
      if (!network) return [];
      const assets = await tx.custodyAsset.findMany({ where: { symbol: request.currency, networkId: network.networkId,
        chainId: '1', isActive: true }, orderBy: { assetId: 'asc' }, take: 101 });
      if (assets.length > 100) throw new ServiceUnavailableException('Deposit asset configuration is unavailable.');
      const options: CustomerDepositAssetOption[] = [];
      for (const asset of assets) {
        try {
          await this.requireEligible(tx, { ...input, assetId: asset.assetId, networkId: network.networkId });
          options.push({ assetId: asset.assetId, networkId: network.networkId, currency: asset.symbol,
            networkName: network.name, tokenStandard: asset.isNative ? null : asset.tokenStandard,
            contractAddress: asset.contractAddress });
        } catch (error) {
          if (!(error instanceof UnprocessableEntityException || error instanceof ServiceUnavailableException)) throw error;
        }
      }
      return options;
    });
  }

  async issue(input: {
    tenantId: string;
    userId: string;
    fundingRequestId: string;
    assetId: string;
    networkId: string;
    idempotencyKey: string;
  }): Promise<CustomerDepositAddressView> {
    this.validateInput(input);
    const provider = this.provider();
    const reserved = await this.reserve(input, provider.credentialFingerprint);
    return this.verifyAndProvision(input, reserved, provider, true);
  }

  async get(input: {
    tenantId: string;
    userId: string;
    fundingRequestId: string;
    assetId: string;
    networkId: string;
  }): Promise<CustomerDepositAddressView> {
    this.validateInput(input);
    const provider = this.provider();
    const reserved = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const eligibility = await this.requireEligible(tx, input);
      const [row] = await tx.$queryRaw<IssuanceRow[]>`
        SELECT * FROM "customer_deposit_address_issuances"
        WHERE "tenant_id"=${input.tenantId}::uuid AND "funding_request_id"=${input.fundingRequestId}::uuid
          AND "asset_id"=${input.assetId} AND "network_id"=${input.networkId}
      `;
      if (!row || row.state !== 'VERIFIED') throw new NotFoundException('Deposit address is not available.');
      this.assertBinding(row, eligibility, provider.credentialFingerprint);
      return { row, eligibility };
    });
    return this.verifyAndProvision(input, reserved, provider, false);
  }

  /**
   * On-demand evidence lookup only. It does not run a monitor, approve
   * compliance, settle a funding request, or credit a customer balance.
   */
  async observeTransfer(input: {
    tenantId: string;
    userId: string;
    fundingRequestId: string;
    assetId: string;
    networkId: string;
    transactionHash: string;
  }): Promise<CustomerDepositObservationView> {
    this.validateInput(input);
    if (!EVM_TRANSACTION_HASH.test(input.transactionHash)) throw new UnprocessableEntityException('Invalid transaction hash.');
    const provider = this.provider();
    const load = () => this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const eligibility = await this.requireEligible(tx, input);
      const [row] = await tx.$queryRaw<IssuanceRow[]>`
        SELECT * FROM "customer_deposit_address_issuances"
        WHERE "tenant_id"=${input.tenantId}::uuid AND "funding_request_id"=${input.fundingRequestId}::uuid
          AND "asset_id"=${input.assetId} AND "network_id"=${input.networkId}
      `;
      if (!row || row.state !== 'VERIFIED' || !row.vault_id || !row.address) throw new NotFoundException('Deposit address is not available.');
      this.assertBinding(row, eligibility, provider.credentialFingerprint);
      return { row, eligibility };
    });
    const initial = await load();
    try {
      const { row, eligibility } = initial;
      const assets = await provider.listSupportedAssets();
      assertProviderAsset(eligibility.asset, assets);
      const vault = await provider.getVault(row.vault_id!);
      assertVault(row, vault);
      if (vault.id !== row.vault_id) throw new FireblocksUnavailable('INVALID_RESPONSE');
      const vaults = await provider.findVaultsByExactName(row.vault_name);
      if (vaults.length !== 1 || vaults[0]!.id !== vault.id) throw new FireblocksUnavailable('AMBIGUOUS');
      assertVault(row, vaults[0]!);
      const wallet = await provider.getVaultAsset(vault.id, row.provider_asset_id);
      if (!wallet || wallet.id !== row.provider_asset_id) throw new FireblocksUnavailable('INVALID_RESPONSE');
      const addresses = await provider.listAddresses(vault.id, row.provider_asset_id);
      if (addresses.length !== 1 || addresses[0]!.tag !== null ||
          addresses[0]!.address.toLowerCase() !== row.address!.toLowerCase() ||
          (addresses[0]!.customerRefId !== null && addresses[0]!.customerRefId !== row.provider_customer_ref)) {
        throw new FireblocksUnavailable('AMBIGUOUS');
      }
      const hits = await provider.findTransactionsByHash({ vaultId: vault.id, assetId: row.provider_asset_id,
        // Allow for small provider/database clock skew and the API's strict
        // "after" boundary; identity is still bound to this exact vault/hash.
        transactionHash: input.transactionHash, afterMs: Math.max(0, row.attempt_started_at.getTime() - 300_000),
        beforeMs: Date.now() + 60_000 });
      if (hits.length === 0 || (hits.length === 1 && hits[0]!.status !== 'COMPLETED')) {
        throw new NotFoundException('No completed transfer observation is available for this address.');
      }
      if (hits.length !== 1) throw new FireblocksUnavailable('AMBIGUOUS');
      const transaction = await provider.getFinalTransaction(hits[0]!.id);
      const receipt = await provider.getEvmReceipt(row.provider_native_asset_id, input.transactionHash);
      const observation = matchIssuedEvmDeposit({
        networkId: row.network_id, chainId: '1', providerAssetId: row.provider_asset_id,
        providerNativeAssetId: row.provider_native_asset_id, vaultId: vault.id,
        customerRefId: row.provider_customer_ref, address: row.address!, decimals: eligibility.asset.decimals,
        isNative: eligibility.asset.isNative, contractAddress: eligibility.asset.contractAddress,
      }, transaction, receipt);
      // The remote lookups do not hold database locks. Recheck ownership,
      // restrictions, issuance and the full asset configuration before return.
      const current = await load();
      if (current.row.id !== row.id || current.row.vault_id !== row.vault_id ||
          current.row.address?.toLowerCase() !== row.address!.toLowerCase() ||
          current.row.vault_name !== row.vault_name || current.row.provider_customer_ref !== row.provider_customer_ref ||
          JSON.stringify(current.eligibility.asset) !== JSON.stringify(eligibility.asset)) {
        throw new FireblocksUnavailable('INVALID_RESPONSE');
      }
      return { ...observation, fundingRequestId: row.funding_request_id, assetId: row.asset_id,
        currency: eligibility.asset.symbol, settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'LOOKUP_ONLY',
        complianceStatus: 'NOT_EVALUATED' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnprocessableEntityException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Transfer evidence could not be verified; no account credit has been confirmed.');
    }
  }

  private provider(): FireblocksVaultClient {
    try {
      const provider = this.providers.create();
      // A sandbox workspace cannot issue Ethereum mainnet funding addresses.
      if (provider.isSandbox) throw new FireblocksUnavailable('CONFIGURATION');
      return provider;
    } catch {
      throw new ServiceUnavailableException('Deposit address provider is unavailable.');
    }
  }

  private validateInput(input: { tenantId: string; userId: string; fundingRequestId: string; assetId: string; networkId: string; idempotencyKey?: string }): void {
    if (!UUID.test(input.tenantId) || !UUID.test(input.userId) || !UUID.test(input.fundingRequestId) ||
        !IDENTIFIER.test(input.assetId) || !IDENTIFIER.test(input.networkId) ||
        (input.idempotencyKey !== undefined && !MUTATION_KEY.test(input.idempotencyKey))) {
      throw new UnprocessableEntityException('Invalid deposit address request.');
    }
  }

  private async reserve(
    input: { tenantId: string; userId: string; fundingRequestId: string; assetId: string; networkId: string; idempotencyKey: string },
    fingerprint: string,
  ): Promise<{ row: IssuanceRow; eligibility: Eligibility }> {
    const keyHash = hash(input.idempotencyKey);
    const intentHash = hash(JSON.stringify(['customer-deposit-address-v1', input.fundingRequestId, input.assetId, input.networkId]));
    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      // Same-key and same-funding locks are acquired in this order everywhere.
      const keyLock = `deposit-address-key:${input.tenantId}:${input.userId}:${keyHash}`;
      const fundingLock = `deposit-address:${input.tenantId}:${input.fundingRequestId}:${input.assetId}:${input.networkId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyLock}, 0))::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fundingLock}, 0))::text`;
      const eligibility = await this.requireEligible(tx, input);
      const [key] = await tx.$queryRaw<Array<{ issuance_id: string; intent_hash: string }>>`
        SELECT "issuance_id", "intent_hash" FROM "customer_deposit_address_request_keys"
        WHERE "tenant_id"=${input.tenantId}::uuid AND "user_id"=${input.userId}::uuid AND "key_hash"=${keyHash}
      `;
      if (key && key.intent_hash !== intentHash) throw new ConflictException('Request key was used for a different deposit address.');
      let [row] = await tx.$queryRaw<IssuanceRow[]>`
        SELECT * FROM "customer_deposit_address_issuances"
        WHERE "tenant_id"=${input.tenantId}::uuid AND "funding_request_id"=${input.fundingRequestId}::uuid
          AND "asset_id"=${input.assetId} AND "network_id"=${input.networkId}
      `;
      if (key && (!row || key.issuance_id !== row.id)) throw new ConflictException('Request key was used for a different deposit address.');
      if (!row) {
        const id = randomUUID();
        const vaultName = `wlct-${hash(JSON.stringify([input.tenantId, id])).slice(0, 40)}`;
        // The account UUID is a stable, non-secret end-client reference. It
        // binds the provider's AML/customer reference to this exact account.
        const customerRef = eligibility.accountId;
        [row] = await tx.$queryRaw<IssuanceRow[]>`
          INSERT INTO "customer_deposit_address_issuances"
            ("id", "tenant_id", "funding_request_id", "account_id", "client_profile_id", "asset_id", "network_id",
             "provider_asset_id", "provider_native_asset_id", "provider_credential_fingerprint", "vault_name", "provider_customer_ref")
          VALUES (${id}::uuid, ${input.tenantId}::uuid, ${input.fundingRequestId}::uuid, ${eligibility.accountId}::uuid,
                  ${eligibility.clientProfileId}::uuid, ${input.assetId}, ${input.networkId}, ${eligibility.asset.providerAssetId},
                  ${eligibility.asset.providerNativeAssetId}, ${fingerprint}, ${vaultName}, ${customerRef})
          RETURNING *
        `;
        if (!row) throw new ServiceUnavailableException('Deposit address intent could not be saved.');
      }
      this.assertBinding(row, eligibility, fingerprint);
      if (!key) {
        await tx.$executeRaw`
          INSERT INTO "customer_deposit_address_request_keys" ("tenant_id", "user_id", "key_hash", "intent_hash", "issuance_id")
          VALUES (${input.tenantId}::uuid, ${input.userId}::uuid, ${keyHash}, ${intentHash}, ${row.id}::uuid)
        `;
      }
      return { row, eligibility };
    });
  }

  private assertBinding(row: IssuanceRow, eligibility: Eligibility, fingerprint: string): void {
    if (row.account_id !== eligibility.accountId || row.client_profile_id !== eligibility.clientProfileId ||
        row.provider_credential_fingerprint !== fingerprint || row.provider_customer_ref !== eligibility.accountId ||
        row.provider_asset_id !== eligibility.asset.providerAssetId || row.provider_native_asset_id !== eligibility.asset.providerNativeAssetId) {
      throw new ServiceUnavailableException('Deposit address ownership or configuration could not be verified.');
    }
    if (row.state === 'MANUAL_REVIEW') throw new ServiceUnavailableException('Deposit address requires provider reconciliation.');
  }

  private async requireOwnedFunding(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; userId: string; fundingRequestId: string },
  ) {
    // Migration-backed triggers take the exclusive forms on every eligibility
    // mutation, including writes from other application versions. Asset and
    // network reads share a global lock; tenant records serialize only within
    // their own tenant. Both locks live until this transaction commits.
    const globalLock = 'customer-deposit-eligibility:global';
    const tenantLock = `customer-deposit-eligibility:${input.tenantId}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${globalLock}, 0))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantLock}, 0))::text`;
    const user = await tx.user.findFirst({ where: { tenantId: input.tenantId, id: input.userId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    const request = await tx.fundingRequest.findFirst({ where: { tenantId: input.tenantId, id: input.fundingRequestId } });
    if (!user || !request) throw new NotFoundException('Funding request not found.');
    const account = await tx.institutionalAccount.findFirst({ where: { tenantId: input.tenantId, id: request.accountId, deletedAt: null } });
    // Older funding requests may not carry a profile. Resolve ownership from
    // the account itself; if the request does name a profile it must match.
    if (!account || (request.clientProfileId !== null && request.clientProfileId !== account.clientProfileId)) {
      throw new NotFoundException('Funding request not found.');
    }
    const profile = account.clientProfileId
      ? await tx.clientProfile.findFirst({ where: { tenantId: input.tenantId, id: account.clientProfileId, deletedAt: null } })
      : null;
    const ownership = await tx.accountOwnership.findFirst({ where: {
      tenantId: input.tenantId, accountId: account.id, ownerId: input.userId, ownerType: 'USER', status: 'ACTIVE',
      ownershipType: { in: ['OWNER', 'BENEFICIAL_OWNER'] }, endedAt: null, effectiveAt: { lte: new Date() },
    }, select: { id: true } });
    if (!(account.ownerId === input.userId && account.ownerType === 'USER') &&
        profile?.externalIdentityRef !== input.userId && !ownership) {
      throw new NotFoundException('Funding request not found.');
    }
    if (account.state !== 'ACTIVE' || !account.isFundingEnabled ||
        (account.clientProfileId && (!profile || !['ACTIVE', 'APPROVED'].includes(profile.status))) ||
        !['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED'].includes(request.state)) {
      throw new UnprocessableEntityException('This funding request cannot receive a deposit address.');
    }
    const restrictions = await tx.accountRestriction.findFirst({ where: {
      tenantId: input.tenantId, status: 'ACTIVE',
      restrictionType: { in: ['NO_DEPOSIT', 'READ_ONLY', 'ACCOUNT_LOCKED', 'COMPLIANCE_HOLD', 'SECURITY_HOLD', 'RISK_HOLD', 'OPERATIONAL_HOLD'] },
      OR: [{ accountId: account.id }, ...(account.clientProfileId ? [{ clientProfileId: account.clientProfileId }] : []), { scope: 'TENANT' }, { scope: 'GLOBAL' }],
    }, select: { id: true } });
    if (restrictions) throw new UnprocessableEntityException('Deposits are restricted for this account.');
    return { request, account };
  }

  private async requireEligible(
    tx: Prisma.TransactionClient,
    input: { tenantId: string; userId: string; fundingRequestId: string; assetId: string; networkId: string },
  ): Promise<Eligibility> {
    const { request, account } = await this.requireOwnedFunding(tx, input);
    const [asset, network] = await Promise.all([
      tx.custodyAsset.findFirst({ where: { assetId: input.assetId, networkId: input.networkId, isActive: true } }),
      tx.custodyNetwork.findFirst({ where: { networkId: input.networkId, status: 'ACTIVE' } }),
    ]);
    // Initially support only Ethereum mainnet and ERC-20. This explicit
    // constraint avoids both memo loss and accidentally returning a testnet or
    // another EVM network address. Other networks need their own evidence path.
    if (!asset || !network || input.networkId !== 'ethereum' || asset.chainId !== '1' || network.chainId !== '1' ||
        asset.symbol !== request.currency || network.nativeAssetSymbol !== 'ETH' ||
        (asset.isNative && (asset.symbol !== 'ETH' || asset.contractAddress !== null)) ||
        (!asset.isNative && (asset.tokenStandard !== 'ERC20' || !asset.contractAddress || !EVM_ADDRESS.test(asset.contractAddress)))) {
      throw new UnprocessableEntityException('The asset or network is not eligible for this deposit.');
    }
    const assetMeta = object(asset.metadata);
    const networkMeta = object(network.metadata);
    const providerAssetId = assetMeta.fireblocksAssetId;
    const providerNativeAssetId = networkMeta.fireblocksNativeAssetId;
    if (typeof providerAssetId !== 'string' || !IDENTIFIER.test(providerAssetId) || providerNativeAssetId !== 'ETH' ||
        (asset.isNative && providerAssetId !== 'ETH')) {
      throw new ServiceUnavailableException('Deposit asset configuration is unavailable.');
    }
    return { accountId: account.id, clientProfileId: account.clientProfileId, asset: {
      id: asset.assetId, symbol: asset.symbol, decimals: asset.decimals, isNative: asset.isNative,
      contractAddress: asset.contractAddress, tokenStandard: asset.tokenStandard,
      providerAssetId, providerNativeAssetId,
    } };
  }

  private async verifyAndProvision(
    input: { tenantId: string; userId: string; fundingRequestId: string; assetId: string; networkId: string },
    reserved: { row: IssuanceRow; eligibility: Eligibility },
    provider: FireblocksVaultClient,
    allowCreate: boolean,
  ): Promise<CustomerDepositAddressView> {
    const lease = randomUUID();
    // The earlier reservation is only a snapshot: a competing request may
    // have completed between that read and our lease acquisition. RETURNING
    // gives us the locked, current row before any provider operation or audit.
    const acquired = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      // Final publication takes eligibility locks before the issuance row.
      // Use the same order here: row-before-eligibility would deadlock a
      // competing finalizer against a new lease acquisition.
      const eligibility = await this.requireEligible(tx, input);
      const [current] = await tx.$queryRaw<IssuanceRow[]>`
        UPDATE "customer_deposit_address_issuances" SET "lease_token"=${lease}::uuid,
          "lease_until"=now() + interval '5 minutes', "updated_at"=now()
        WHERE "tenant_id"=${input.tenantId}::uuid AND "id"=${reserved.row.id}::uuid
          AND "state" IN ('PENDING','VERIFIED') AND ("lease_until" IS NULL OR "lease_until" < now())
        RETURNING *
      `;
      if (!current) return null;
      this.assertBinding(current, eligibility, provider.credentialFingerprint);
      if (!allowCreate && current.state !== 'VERIFIED') throw new NotFoundException('Deposit address is not available.');
      return { row: current, eligibility };
    });
    if (!acquired) throw new ServiceUnavailableException('Deposit address verification is in progress; retry shortly.');
    let row = acquired.row;
    reserved = acquired;
    try {
      const assets = await provider.listSupportedAssets();
      assertProviderAsset(reserved.eligibility.asset, assets);
      await this.renew(input.tenantId, row.id, lease);
      let matches = await provider.findVaultsByExactName(row.vault_name);
      if (matches.length > 1) throw new FireblocksUnavailable('AMBIGUOUS');
      let vault: FireblocksVault;
      if (matches.length === 1) {
        vault = matches[0]!;
      } else {
        if (!allowCreate || row.state === 'VERIFIED' || !isRetrySafe(row.attempt_started_at)) {
          await this.manualReview(input.tenantId, row.id, lease);
          throw new FireblocksUnavailable('AMBIGUOUS');
        }
        vault = await provider.createVault(row.vault_name, row.provider_customer_ref, providerKey('vault', row.id));
      }
      assertVault(row, vault);
      vault = await provider.getVault(vault.id);
      assertVault(row, vault);
      if (row.vault_id !== null && row.vault_id !== vault.id) throw new FireblocksUnavailable('AMBIGUOUS');
      await this.setVault(input.tenantId, row.id, lease, vault.id);
      matches = await provider.findVaultsByExactName(row.vault_name);
      if (matches.length !== 1 || matches[0]!.id !== vault.id) throw new FireblocksUnavailable('AMBIGUOUS');
      assertVault(row, matches[0]!);
      await this.renew(input.tenantId, row.id, lease);
      let wallet = await provider.getVaultAsset(vault.id, row.provider_asset_id);
      if (!wallet) {
        if (!allowCreate || row.state === 'VERIFIED' || !isRetrySafe(row.attempt_started_at)) {
          await this.manualReview(input.tenantId, row.id, lease);
          throw new FireblocksUnavailable('AMBIGUOUS');
        }
        await provider.createVaultAsset(vault.id, row.provider_asset_id, providerKey('asset', row.id));
        wallet = await provider.getVaultAsset(vault.id, row.provider_asset_id);
      }
      if (!wallet || wallet.id !== row.provider_asset_id) throw new FireblocksUnavailable('INVALID_RESPONSE');
      await this.renew(input.tenantId, row.id, lease);
      const addresses = await provider.listAddresses(vault.id, row.provider_asset_id);
      if (addresses.length !== 1) throw new FireblocksUnavailable('AMBIGUOUS');
      const address = addresses[0]!;
      if (!EVM_ADDRESS.test(address.address) || /^0x0{40}$/i.test(address.address) || address.tag !== null ||
          (address.customerRefId !== null && address.customerRefId !== row.provider_customer_ref) ||
          (row.address !== null && row.address.toLowerCase() !== address.address.toLowerCase())) {
        throw new FireblocksUnavailable('INVALID_RESPONSE');
      }
      row = await this.prisma.withTenantRls(input.tenantId, async (tx) => {
        const eligibility = await this.requireEligible(tx, input);
        this.assertBinding(row, eligibility, provider.credentialFingerprint);
        const [updated] = await tx.$queryRaw<IssuanceRow[]>`
          UPDATE "customer_deposit_address_issuances"
          SET "vault_id"=${vault.id}, "address"=${address.address}, "state"='VERIFIED', "verified_at"=now(),
              "lease_token"=NULL, "lease_until"=NULL, "last_failure_code"=NULL, "updated_at"=now()
          WHERE "tenant_id"=${input.tenantId}::uuid AND "id"=${row.id}::uuid AND "lease_token"=${lease}::uuid
            AND "lease_until">now() AND "state" IN ('PENDING','VERIFIED')
          RETURNING *
        `;
        if (!updated) throw new ServiceUnavailableException('Deposit verification lease expired; retry.');
        if (row.state !== 'VERIFIED') {
          await tx.clientLifecycleAudit.create({ data: {
            tenantId: input.tenantId, accountId: row.account_id, clientProfileId: row.client_profile_id,
            action: 'DEPOSIT_ADDRESS_VERIFIED', entityType: 'CUSTOMER_DEPOSIT_ADDRESS', entityId: row.id,
            actorId: input.userId, actorType: 'USER', toState: 'VERIFIED',
            evidence: { fundingRequestId: row.funding_request_id, assetId: row.asset_id, networkId: row.network_id, provider: 'fireblocks', vaultId: vault.id },
          } });
        }
        return updated;
      });
      return {
        fundingRequestId: row.funding_request_id, accountId: row.account_id, assetId: row.asset_id,
        currency: reserved.eligibility.asset.symbol, networkId: row.network_id, address: row.address!,
        status: 'ADDRESS_VERIFIED', settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'NOT_CONNECTED',
        verifiedAt: row.verified_at!.toISOString(),
      };
    } catch (error) {
      const code = error instanceof FireblocksUnavailable ? error.code : 'VERIFICATION_FAILED';
      await this.prisma.withTenantRls(input.tenantId, (tx) => tx.$executeRaw`
        UPDATE "customer_deposit_address_issuances" SET "lease_token"=NULL, "lease_until"=NULL,
          "last_failure_code"=${code}, "updated_at"=now()
        WHERE "tenant_id"=${input.tenantId}::uuid AND "id"=${row.id}::uuid AND "lease_token"=${lease}::uuid
      `).catch(() => undefined);
      if (error instanceof NotFoundException || error instanceof UnprocessableEntityException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Deposit address could not be verified; no transfer has been confirmed.');
    }
  }

  private async renew(tenantId: string, id: string, lease: string): Promise<void> {
    const count = await this.prisma.withTenantRls(tenantId, (tx) => tx.$executeRaw`
      UPDATE "customer_deposit_address_issuances" SET "lease_until"=now() + interval '5 minutes', "updated_at"=now()
      WHERE "tenant_id"=${tenantId}::uuid AND "id"=${id}::uuid AND "lease_token"=${lease}::uuid AND "lease_until">now()
    `);
    if (count !== 1) throw new ServiceUnavailableException('Deposit verification lease expired; retry.');
  }

  private async setVault(tenantId: string, id: string, lease: string, vaultId: string): Promise<void> {
    const count = await this.prisma.withTenantRls(tenantId, (tx) => tx.$executeRaw`
      UPDATE "customer_deposit_address_issuances" SET "vault_id"=${vaultId}, "updated_at"=now()
      WHERE "tenant_id"=${tenantId}::uuid AND "id"=${id}::uuid AND "lease_token"=${lease}::uuid AND "lease_until">now()
        AND ("vault_id" IS NULL OR "vault_id"=${vaultId})
    `);
    if (count !== 1) throw new ServiceUnavailableException('Deposit verification lease expired or vault identity changed.');
  }

  private async manualReview(tenantId: string, id: string, lease: string): Promise<void> {
    await this.prisma.withTenantRls(tenantId, (tx) => tx.$executeRaw`
      UPDATE "customer_deposit_address_issuances" SET "state"='MANUAL_REVIEW', "updated_at"=now()
      WHERE "tenant_id"=${tenantId}::uuid AND "id"=${id}::uuid AND "lease_token"=${lease}::uuid AND "lease_until">now()
    `);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function providerKey(kind: 'vault' | 'asset', id: string): string {
  return hash(`customer-deposit:${kind}:${id}`).slice(0, 40);
}

function isRetrySafe(startedAt: Date): boolean {
  const elapsed = Date.now() - startedAt.getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < SAFE_RETRY_MS;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertVault(row: IssuanceRow, vault: FireblocksVault): void {
  if (vault.name !== row.vault_name || vault.customerRefId !== row.provider_customer_ref) throw new FireblocksUnavailable('INVALID_RESPONSE');
}

function assertProviderAsset(local: AssetEvidence, providerAssets: FireblocksAsset[]): void {
  const provider = providerAssets.find((item) => item.id === local.providerAssetId);
  if (!provider || provider.decimals === null || provider.decimals !== local.decimals ||
      (local.isNative && (provider.id !== local.providerNativeAssetId || provider.contractAddress !== null)) ||
      (!local.isNative && (provider.nativeAsset !== local.providerNativeAssetId || provider.type !== 'ERC20' ||
        !provider.contractAddress || !local.contractAddress || provider.contractAddress.toLowerCase() !== local.contractAddress.toLowerCase()))) {
    throw new FireblocksUnavailable('INVALID_RESPONSE');
  }
}

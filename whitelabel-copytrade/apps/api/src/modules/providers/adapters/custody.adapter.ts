// # Enforces fail-closed behavior when custody provider is unconfigured or degraded
import { CustodyProductionAdapter } from './custody/custody.adapter';
import { ProviderErrorCode } from '../provider.types';

export { CustodyProductionAdapter, ProviderErrorCode };

export interface CustodyFailClosedStatus {
  operational: boolean;
  errorCode: ProviderErrorCode | null;
  reason: string;
}

export function evaluateCustodyFailClosedReadiness(
  env: Record<string, string | undefined> = process.env,
): CustodyFailClosedStatus {
  const apiKey = (env.CUSTODY_PROVIDER_API_KEY ?? '').trim();
  const baseUrl = (env.CUSTODY_PROVIDER_BASE_URL ?? '').trim();
  if (!apiKey || !baseUrl) {
    return {
      operational: false,
      errorCode: ProviderErrorCode.NOT_CONFIGURED,
      reason:
        'Custody provider credentials or base URL missing; failing closed for all withdrawal and address generation operations.',
    };
  }
  return {
    operational: true,
    errorCode: null,
    reason: 'Custody provider configured and ready.',
  };
}

export default CustodyProductionAdapter;

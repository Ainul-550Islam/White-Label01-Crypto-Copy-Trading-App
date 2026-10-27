import { REDACTED_PLACEHOLDER } from '@wlct/config';

/** Never serialize credential-bearing or funding/withdrawal payloads, even when
 * general request-body logging is enabled. Paths may have a custom API prefix. */
export function requestBodyForLog(url: string, body: unknown): unknown {
  const path = url.split('?')[0];
  return /(?:^|\/)(?:(?:auth|developer-platform)(?:\/|$)|notifications\/push-devices(?:\/|$)|custody\/destinations(?:\/|$)|client-lifecycle\/(?:funding|withdrawal-destination-check|withdrawals)(?:\/|$))/i.test(path)
    ? REDACTED_PLACEHOLDER : body;
}

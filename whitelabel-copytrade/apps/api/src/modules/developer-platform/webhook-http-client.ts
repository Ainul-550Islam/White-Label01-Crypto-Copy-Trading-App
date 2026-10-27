import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { WebhookHttpClient } from './webhook-delivery.service';

// Explicitly deny special-use and non-public ranges, including cloud metadata,
// IPv4-mapped IPv6, carrier-grade NAT, multicast and documentation ranges.
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blocked.addSubnet(address, prefix, 'ipv6');

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');

export function isPublicWebhookAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Reject mapped, compatible, NAT64 and other non-global IPv6 addresses as
  // well as 6to4/Teredo, which can embed an otherwise blocked IPv4 target.
  if (family === 6) return globalIpv6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}

/** Reject malformed URLs and local literal targets before saving a webhook. */
export function parseWebhookTarget(value: string): URL | null {
  if (value.length > 512 || !/^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9/\-._~%]*$/.test(value)) return null;
  try {
    const target = new URL(value);
    const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
    if (target.protocol !== 'https:' || target.port || !hostname || target.username || target.password || target.search || target.hash ||
        hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return null;
    if (isIP(hostname) && !isPublicWebhookAddress(hostname)) return null;
    return target;
  } catch { return null; }
}

type Address = { address: string; family: number };
type Resolve = (hostname: string) => Promise<Address[]>;
type Send = typeof httpsRequest;

/**
 * Resolve every time, reject a mixed/private DNS answer, and pin the socket to
 * one vetted IP while retaining the original TLS hostname and certificate
 * verification. Node's HTTPS client does not follow redirects. The response is
 * closed without buffering its untrusted body; one deadline covers DNS and IO.
 */
export class SecureWebhookHttpClient implements WebhookHttpClient {
  constructor(
    private readonly resolve: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true }),
    private readonly send: Send = httpsRequest,
  ) {}

  post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{
    status?: number; timedOut?: boolean; networkError?: boolean;
  }> {
    return new Promise((resolve) => {
      let settled = false;
      let outgoing: ClientRequest | undefined;
      const finish = (result: { status?: number; timedOut?: boolean; networkError?: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => { finish({ timedOut: true }); outgoing?.destroy(); }, timeoutMs);
      void (async () => {
        try {
          const target = parseWebhookTarget(url);
          if (!target) return finish({ networkError: true });
          const addresses = await this.resolve(target.hostname);
          if (settled) return;
          if (!addresses.length || addresses.some((entry) => !isPublicWebhookAddress(entry.address))) {
            return finish({ networkError: true });
          }
          const chosen = addresses[0];
          outgoing = this.send(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            family: chosen.family,
            maxHeaderSize: 16 * 1024,
            lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
          }, (response) => {
            const status = response.statusCode;
            response.destroy();
            finish(status === undefined ? { networkError: true } : { status });
          });
          outgoing.on('error', () => finish({ networkError: true }));
          outgoing.end(body);
        } catch {
          finish({ networkError: true });
        }
      })();
    });
  }
}

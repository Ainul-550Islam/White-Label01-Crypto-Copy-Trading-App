import { EventEmitter } from 'node:events';
import { isPublicWebhookAddress, parseWebhookTarget, SecureWebhookHttpClient } from './webhook-http-client';

describe('secure outbound webhook transport', () => {
  it('rejects non-public literal addresses and malformed or credential-bearing URLs', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', 'ff02::1']) {
      expect(isPublicWebhookAddress(address)).toBe(false);
    }
    expect(isPublicWebhookAddress('8.8.8.8')).toBe(true);
    expect(isPublicWebhookAddress('2606:4700:4700::1111')).toBe(true);
    for (const url of ['http://example.com/hook', 'https://localhost/hook', 'https://169.254.169.254/', 'https://user:pass@example.com/', 'https://example.com/?secret=x', 'https://:', `https://example.com/${'x'.repeat(500)}`]) {
      expect(parseWebhookTarget(url)).toBeNull();
    }
    expect(parseWebhookTarget('https://hooks.example.com:8443/v1/hook')).toBeNull();
    expect(parseWebhookTarget('https://hooks.example.com:443/v1/hook')?.hostname).toBe('hooks.example.com');
  });

  it('never connects if DNS resolves to a private address, even in a mixed answer', async () => {
    const send = jest.fn();
    const client = new SecureWebhookHttpClient(async () => [
      { address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 },
    ], send as never);
    await expect(client.post('https://hooks.example.com/path', {}, '{}', 1000)).resolves.toEqual({ networkError: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('pins a vetted address, does not follow redirects, and discards the untrusted body', async () => {
    const destroyed = jest.fn();
    const outgoing = Object.assign(new EventEmitter(), { end: jest.fn(), destroy: jest.fn() });
    const send = jest.fn((_url, options, callback) => {
      const lookupCallback = jest.fn();
      options.lookup('hooks.example.com', {}, lookupCallback);
      expect(lookupCallback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
      process.nextTick(() => callback({ statusCode: 302, headers: { location: 'http://127.0.0.1/' }, destroy: destroyed }));
      return outgoing;
    });
    const client = new SecureWebhookHttpClient(async () => [{ address: '8.8.8.8', family: 4 }], send as never);
    await expect(client.post('https://hooks.example.com/path', { 'X-Signature': 'signature' }, '{"event":true}', 1000)).resolves.toEqual({ status: 302 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(outgoing.end).toHaveBeenCalledWith('{"event":true}');
    expect(destroyed).toHaveBeenCalledTimes(1);
  });

  it('bounds DNS resolution and never connects after a timeout', async () => {
    const send = jest.fn();
    let finishDns!: (addresses: { address: string; family: number }[]) => void;
    const client = new SecureWebhookHttpClient(() => new Promise((resolve) => { finishDns = resolve; }), send as never);
    await expect(client.post('https://hooks.example.com/path', {}, '{}', 10)).resolves.toEqual({ timedOut: true });
    finishDns([{ address: '8.8.8.8', family: 4 }]);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });
});

// # Direct APNs HTTP/2 delivery. Provider acceptance is not a device receipt.
import { Injectable } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { connect, constants } from 'node:http2';

type PushResult = { accepted: boolean; retryable: boolean; code: string; invalidToken?: boolean };
@Injectable()
export class ApnsPushService {
  async send(token: string, title: string, body: string): Promise<PushResult> {
    const team = process.env.APNS_TEAM_ID?.trim(), keyId = process.env.APNS_KEY_ID?.trim();
    const key = process.env.APNS_PRIVATE_KEY_BASE64?.trim(), topic = process.env.APNS_TOPIC?.trim();
    if (!team || !keyId || !key || !topic || !/^[A-Za-z0-9.\-]{1,255}$/.test(topic)) return { accepted: false, retryable: false, code: 'APNS_NOT_CONFIGURED' };
    if (!/^[a-fA-F0-9]{64,200}$/.test(token)) return { accepted: false, retryable: false, code: 'INVALID_DEVICE_TOKEN', invalidToken: true };
    let jwt: string;
    try {
      const head = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: team, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
      const unsigned = `${head}.${claims}`;
      const signer = createSign('SHA256'); signer.update(unsigned); signer.end();
      jwt = `${unsigned}.${signer.sign({ key: Buffer.from(key, 'base64').toString('utf8'), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    } catch { return { accepted: false, retryable: false, code: 'APNS_NOT_CONFIGURED' }; }
    const host = process.env.APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    return new Promise<PushResult>((resolve) => {
      const session = connect(host); let settled = false;
      const finish = (value: PushResult) => { if (settled) return; settled = true; clearTimeout(timer); session.destroy(); resolve(value); };
      const timer = setTimeout(() => finish({ accepted: false, retryable: true, code: 'APNS_TIMEOUT' }), 10_000);
      session.on('error', () => finish({ accepted: false, retryable: true, code: 'APNS_UNAVAILABLE' }));
      const request = session.request({ [constants.HTTP2_HEADER_METHOD]: 'POST', [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`, authorization: `bearer ${jwt}`, 'apns-topic': topic, 'apns-push-type': 'alert', 'content-type': 'application/json' });
      let status = 0, response = '';
      request.on('response', (headers) => { status = Number(headers[constants.HTTP2_HEADER_STATUS]); });
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { if (response.length < 4096) response += chunk; });
      request.on('error', () => finish({ accepted: false, retryable: true, code: 'APNS_UNAVAILABLE' }));
      request.on('end', () => {
        if (status === 200) return finish({ accepted: true, retryable: false, code: 'ACCEPTED' });
        let reason = ''; try { reason = String((JSON.parse(response) as { reason?: unknown }).reason ?? ''); } catch { /* provider body is never logged */ }
        const invalidToken = status === 410 || (status === 400 && reason === 'BadDeviceToken');
        return finish({ accepted: false, retryable: status === 429 || status >= 500, code: invalidToken ? 'INVALID_DEVICE_TOKEN' : status === 429 || status >= 500 ? 'APNS_TEMPORARY_FAILURE' : 'APNS_REFUSED', invalidToken });
      });
      request.end(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }));
    });
  }
}

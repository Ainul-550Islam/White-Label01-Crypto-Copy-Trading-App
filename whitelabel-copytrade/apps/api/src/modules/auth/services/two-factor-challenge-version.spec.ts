import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@wlct/shared-types';
import { TokenService } from './token.service';

const jwt = new JwtService();
const config = { jwtAccessSigningKey: 'synthetic-key-for-version-test', jwtAccessVerificationKey: 'synthetic-key-for-version-test',
  jwtAlgorithm: 'HS256', twoFactorChallengeTtlSeconds: 300, twoFactorMaxChallengeAttempts: 3, jwtIssuer: 'test', jwtAudience: 'test' };
const cache = { get: jest.fn(async () => null), increment: jest.fn(async () => 1), set: jest.fn(), delete: jest.fn() };
const service = new TokenService(jwt, config as never, {} as never, {} as never, cache as never, {} as never, {} as never, {} as never);

describe('two-factor challenge credential generation', () => {
  it('cryptographically signs and verifies the captured session version', async () => {
    const challenge = await service.issueTwoFactorChallenge('user', 'tenant', 'device', { sessionVersion: 12, sso: 'sso-reference' });
    const payload = await service.verifyTwoFactorChallenge(challenge.token);
    expect(payload).toMatchObject({ sub: 'user', tid: 'tenant', did: 'device', typ: '2fa_challenge', sv: 12, sso: 'sso-reference' });
  });

  it('rejects a signed legacy challenge that is not bound to a credential generation', async () => {
    const legacy = await jwt.signAsync({ sub: 'user', tid: 'tenant', did: 'device', typ: '2fa_challenge', jti: 'legacy' },
      { secret: config.jwtAccessSigningKey, algorithm: 'HS256', issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: 300 });
    await expect(service.verifyTwoFactorChallenge(legacy)).rejects.toMatchObject({ code: ErrorCode.TOKEN_INVALID });
  });
});

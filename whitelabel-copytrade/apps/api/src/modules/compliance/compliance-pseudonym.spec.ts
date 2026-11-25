import { afterEach, describe, expect, it } from '@jest/globals';

import { hashPii } from './compliance.types';

const originalSecret = process.env.DEVELOPER_SECRET_HMAC_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.DEVELOPER_SECRET_HMAC_KEY;
  else process.env.DEVELOPER_SECRET_HMAC_KEY = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('compliance PII pseudonyms', () => {
  it('uses deterministic HMAC-SHA256 output and separates identity domains', () => {
    process.env.NODE_ENV = 'test';
    process.env.DEVELOPER_SECRET_HMAC_KEY = 'test-compliance-secret-key-0001';

    const email = hashPii('member@example.test', 'kyc:identity:email');
    expect(email).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPii('member@example.test', 'kyc:identity:email')).toBe(email);
    expect(hashPii('member@example.test', 'aml:transaction:counterparty')).not.toBe(email);
  });

  it('changes pseudonyms when the platform HMAC secret rotates', () => {
    process.env.NODE_ENV = 'test';
    process.env.DEVELOPER_SECRET_HMAC_KEY = 'test-compliance-secret-key-0001';
    const before = hashPii('same-value', 'kyc:identity:email');

    process.env.DEVELOPER_SECRET_HMAC_KEY = 'rotated-compliance-secret-key-0002';
    expect(hashPii('same-value', 'kyc:identity:email')).not.toBe(before);
  });

  it('refuses to use the non-production fallback in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEVELOPER_SECRET_HMAC_KEY;

    expect(() => hashPii('member@example.test', 'kyc:identity:email')).toThrow(/DEVELOPER_SECRET_HMAC_KEY/);
  });
});

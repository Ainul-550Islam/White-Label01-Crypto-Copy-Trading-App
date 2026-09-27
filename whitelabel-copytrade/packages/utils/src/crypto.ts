import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Low-level cryptographic primitives shared by the API and worker processes.
 *
 * Exchange API secrets use envelope encryption:
 *   1. A random 256-bit Data Encryption Key (DEK) is generated per record.
 *   2. The payload is sealed with AES-256-GCM under the DEK.
 *   3. The DEK itself is wrapped with the Key Encryption Key (KEK) that lives in
 *      the environment (local provider) or in a managed KMS (kms provider).
 * Rotating the KEK therefore only requires re-wrapping DEKs, not re-encrypting
 * every ciphertext.
 */

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface SealedPayload {
  /** Base64 ciphertext of the plaintext under the DEK. */
  ciphertext: string;
  /** Base64 IV used for the payload cipher. */
  iv: string;
  /** Base64 GCM authentication tag for the payload. */
  authTag: string;
  /** Base64 DEK wrapped under the KEK (iv + tag + ciphertext concatenated). */
  wrappedKey: string;
  /** Identifier of the KEK used, enabling rotation. */
  keyId: string;
  /** Algorithm marker for forward compatibility. */
  algorithm: 'aes-256-gcm';
  /** Encryption schema version. */
  version: 1;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export function generateKeyBase64(bytes = KEY_LENGTH): string {
  return randomBytes(bytes).toString('base64');
}

export function decodeKey(base64Key: string, expectedLength = KEY_LENGTH): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== expectedLength) {
    throw new CryptoError(
      `Invalid key length: expected ${expectedLength} bytes, received ${key.length}`,
    );
  }
  return key;
}

function aesEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad) {
    cipher.setAAD(aad);
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function aesDecrypt(key: Buffer, payload: Buffer, aad?: Buffer): Buffer {
  if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new CryptoError('Ciphertext payload is truncated');
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  if (aad) {
    decipher.setAAD(aad);
  }
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Seals plaintext with a freshly generated DEK wrapped by the provided KEK.
 * `aad` binds the ciphertext to a context (for example `${tenantId}:${userId}`)
 * so a row copied into another tenant fails authentication on decrypt.
 */
export function sealWithEnvelope(
  plaintext: string,
  kek: Buffer,
  keyId: string,
  aad?: string,
): SealedPayload {
  const dek = randomBytes(KEY_LENGTH);
  const aadBuffer = aad ? Buffer.from(aad, 'utf8') : undefined;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aadBuffer) {
    cipher.setAAD(aadBuffer);
  }
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const wrappedKey = aesEncrypt(kek, dek, aadBuffer);
  dek.fill(0);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    wrappedKey: wrappedKey.toString('base64'),
    keyId,
    algorithm: AES_ALGORITHM,
    version: 1,
  };
}

/** Reverses {@link sealWithEnvelope}. Throws when the payload was tampered with. */
export function openEnvelope(payload: SealedPayload, kek: Buffer, aad?: string): string {
  if (payload.algorithm !== AES_ALGORITHM || payload.version !== 1) {
    throw new CryptoError('Unsupported envelope version or algorithm');
  }
  const aadBuffer = aad ? Buffer.from(aad, 'utf8') : undefined;
  const dek = aesDecrypt(kek, Buffer.from(payload.wrappedKey, 'base64'), aadBuffer);
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, dek, Buffer.from(payload.iv, 'base64'), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    if (aadBuffer) {
      decipher.setAAD(aadBuffer);
    }
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Deterministic HMAC used for equality lookups on encrypted columns. */
export function blindIndex(value: string, key: Buffer): string {
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

/** Non-reversible identifier for IP addresses stored alongside audit records. */
export function hashIpAddress(ip: string, key: Buffer): string {
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash used to store refresh tokens: the raw token never touches the database. */
export function hashToken(token: string, pepper: Buffer): string {
  return createHmac('sha512', pepper).update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const value = randomBytes(4).readUInt32BE(0) % max;
  return value.toString().padStart(digits, '0');
}

/** Human friendly recovery code, e.g. `A1B2-C3D4-E5F6`. */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    chars.push(alphabet[bytes[index] % alphabet.length]);
  }
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function newUuid(): string {
  return randomUUID();
}

/** Constant-time comparison that tolerates differing lengths. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison to keep the timing profile flat.
    const padded = Buffer.alloc(bufferA.length, 0);
    timingSafeEqual(bufferA, padded);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

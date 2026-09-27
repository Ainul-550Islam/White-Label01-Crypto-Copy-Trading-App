import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  blindIndex,
  generateOpaqueToken,
  generateRecoveryCode,
  hashIpAddress,
  hashToken,
  maskSecret,
  openEnvelope,
  sealWithEnvelope,
  sha256Hex,
  type SealedPayload,
} from '@wlct/utils';

import { KeyProvider } from './key.provider';

/**
 * Application-facing cryptography.
 *
 * Exchange API secrets, TOTP seeds and any other high-value string is stored as
 * a {@link SealedPayload} produced here. Plaintext exists only inside the
 * function that needs it and is never returned by a controller.
 */
@Injectable()
export class CryptoService {
  constructor(
    private readonly keys: KeyProvider,
    @InjectPinoLogger(CryptoService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Encrypts a secret under the active KEK.
   *
   * @param plaintext the secret to protect
   * @param aad additional authenticated data binding the ciphertext to its
   *            owner, e.g. `${tenantId}:${userId}:exchange_secret`. Decryption
   *            fails if the row is moved to another tenant or user.
   */
  encrypt(plaintext: string, aad?: string): SealedPayload {
    try {
      return sealWithEnvelope(plaintext, this.keys.activeKey, this.keys.activeKeyId, aad);
    } catch (error) {
      // The message is logged without any part of the plaintext.
      this.logger.error(
        { event: 'encryption.failed', keyId: this.keys.activeKeyId },
        `Encryption failed: ${(error as Error).name}`,
      );
      throw error;
    }
  }

  /** Decrypts a payload produced by {@link encrypt}. */
  decrypt(payload: SealedPayload, aad?: string): string {
    try {
      return openEnvelope(payload, this.keys.resolve(payload.keyId), aad);
    } catch (error) {
      this.logger.error(
        { event: 'decryption.failed', keyId: payload.keyId },
        `Decryption failed: ${(error as Error).name}`,
      );
      throw error;
    }
  }

  /** Re-wraps an existing payload under the current active key. */
  rotate(payload: SealedPayload, aad?: string): SealedPayload {
    const plaintext = this.decrypt(payload, aad);
    try {
      return this.encrypt(plaintext, aad);
    } finally {
      // Best effort: JS strings are immutable, so the GC is the real boundary.
    }
  }

  /** Deterministic index for equality lookups on encrypted columns. */
  blindIndex(value: string): string {
    return blindIndex(value, this.keys.blindIndexKey);
  }

  /** Keyed, non-reversible representation of a client IP. */
  hashIp(ip: string): string {
    return hashIpAddress(ip, this.keys.blindIndexKey);
  }

  /** HMAC used to store refresh tokens and API key secrets. */
  hashToken(token: string): string {
    return hashToken(token, this.keys.blindIndexKey);
  }

  sha256(value: string): string {
    return sha256Hex(value);
  }

  generateToken(bytes = 48): string {
    return generateOpaqueToken(bytes);
  }

  generateRecoveryCode(): string {
    return generateRecoveryCode();
  }

  mask(value: string): string {
    return maskSecret(value);
  }
}

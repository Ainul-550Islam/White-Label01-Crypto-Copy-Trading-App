import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CryptoError, decodeKey } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Key Encryption Key (KEK) management.
 *
 * Rotation model:
 *   - `activeKeyId` is used for all new encryptions;
 *   - previous keys stay available for decryption only, so a rotation does not
 *     require a synchronous re-encryption of every stored credential;
 *   - a background job (Part 2) re-wraps records lazily and drops retired keys.
 *
 * With `ENCRYPTION_PROVIDER=kms`, `resolve()` is the single method that must be
 * re-implemented to call the cloud KMS instead of reading local material.
 */
@Injectable()
export class KeyProvider implements OnModuleInit {
  private readonly keys = new Map<string, Buffer>();
  private activeKeyIdValue = '';
  private blindIndexKeyValue!: Buffer;

  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger(KeyProvider.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.activeKeyIdValue = this.config.encryptionKeyId;
    this.keys.set(this.activeKeyIdValue, decodeKey(this.config.encryptionMasterKeyBase64));

    for (const [keyId, material] of Object.entries(this.config.encryptionPreviousKeys)) {
      if (keyId === this.activeKeyIdValue) {
        continue;
      }
      this.keys.set(keyId, decodeKey(material));
    }

    this.blindIndexKeyValue = Buffer.from(this.config.blindIndexKeyBase64, 'base64');

    if (this.config.encryptionProvider === 'kms') {
      this.logger.warn(
        { event: 'encryption.provider', provider: 'kms' },
        'KMS provider selected: implement KeyProvider.resolve() against your KMS before production use',
      );
    }

    // Key identifiers are safe to log; key material never is.
    this.logger.info(
      {
        event: 'encryption.keys_loaded',
        activeKeyId: this.activeKeyIdValue,
        retiredKeyIds: [...this.keys.keys()].filter((id) => id !== this.activeKeyIdValue),
      },
      'Encryption keys loaded',
    );
  }

  get activeKeyId(): string {
    return this.activeKeyIdValue;
  }

  /** Returns the KEK for a given key id, or throws when it has been retired. */
  resolve(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new CryptoError(
        `Encryption key "${keyId}" is not available in this environment. ` +
          'Add it to ENCRYPTION_PREVIOUS_KEYS_JSON to decrypt legacy records.',
      );
    }
    return key;
  }

  get activeKey(): Buffer {
    return this.resolve(this.activeKeyIdValue);
  }

  get blindIndexKey(): Buffer {
    return this.blindIndexKeyValue;
  }
}

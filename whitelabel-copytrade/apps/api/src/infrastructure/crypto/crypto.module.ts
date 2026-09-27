import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';
import { KeyProvider } from './key.provider';

/**
 * Cryptographic services.
 *
 * Everything that touches key material lives behind this module so key access
 * is auditable in one place and can be swapped for a KMS implementation
 * without changing a single call site.
 */
@Global()
@Module({
  providers: [KeyProvider, CryptoService, PasswordService],
  exports: [CryptoService, PasswordService, KeyProvider],
})
export class CryptoModule {}

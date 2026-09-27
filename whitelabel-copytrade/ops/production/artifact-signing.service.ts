/**
 * Artifact Signing Service
 * Creates or verifies cryptographic signatures for approved release artifacts
 * using secure signing infrastructure. Private signing keys must never be committed or logged.
 */

import * as crypto from 'crypto';

export interface SigningInput {
  artifactDigest: string;
  releaseId: string;
  correlationId: string;
  signerId: string;
}

export interface VerificationInput {
  artifactDigest: string;
  signature: string;
  publicKey?: string;
  correlationId: string;
}

export interface SigningResult {
  releaseId: string;
  artifactDigest: string;
  signature: string;
  signatureDigest: string;
  signerId: string;
  signedAt: string;
  correlationId: string;
}

export interface VerificationResult {
  valid: boolean;
  artifactDigest: string;
  signatureDigest: string;
  signerId?: string;
  failureReason?: string;
  verifiedAt: string;
  correlationId: string;
}

export class ArtifactSigningService {
  async sign(input: SigningInput): Promise<SigningResult> {
    if (!input.artifactDigest) {
      throw new Error('artifactDigest required for signing');
    }

    const signingKeyId = process.env['ARTIFACT_SIGNING_KEY_ID'] || 'local-signing-key';
    const privateKeyPem = process.env['ARTIFACT_SIGNING_PRIVATE_KEY'];

    let signature: string;
    if (privateKeyPem) {
      const sign = crypto.createSign('SHA256');
      sign.update(input.artifactDigest);
      sign.end();
      signature = sign.sign(privateKeyPem, 'base64');
    } else {
      const hmacKey = process.env['ARTIFACT_SIGNING_HMAC_KEY'] || 'development-only-hmac-key-not-for-production';
      if (process.env['NODE_ENV'] === 'production' && hmacKey === 'development-only-hmac-key-not-for-production') {
        throw new Error('ARTIFACT_SIGNING_HMAC_KEY or private key required in production');
      }
      signature = crypto.createHmac('sha256', hmacKey).update(input.artifactDigest).digest('base64');
    }

    const signatureDigest = crypto.createHash('sha256').update(signature).digest('hex');

    return {
      releaseId: input.releaseId,
      artifactDigest: this.redactDigest(input.artifactDigest),
      signature,
      signatureDigest,
      signerId: input.signerId || signingKeyId,
      signedAt: new Date().toISOString(),
      correlationId: input.correlationId,
    };
  }

  async verify(input: VerificationInput): Promise<VerificationResult> {
    const verifiedAt = new Date().toISOString();

    if (!input.signature) {
      return {
        valid: false,
        artifactDigest: this.redactDigest(input.artifactDigest),
        signatureDigest: '',
        failureReason: 'Signature missing',
        verifiedAt,
        correlationId: input.correlationId,
      };
    }

    if (!input.artifactDigest) {
      return {
        valid: false,
        artifactDigest: '***MISSING***',
        signatureDigest: this.redactDigest(input.signature),
        failureReason: 'Artifact digest missing',
        verifiedAt,
        correlationId: input.correlationId,
      };
    }

    try {
      const publicKeyPem = input.publicKey || process.env['ARTIFACT_SIGNING_PUBLIC_KEY'];
      const hmacKey = process.env['ARTIFACT_SIGNING_HMAC_KEY'];

      let valid = false;
      if (publicKeyPem) {
        const verify = crypto.createVerify('SHA256');
        verify.update(input.artifactDigest);
        verify.end();
        valid = verify.verify(publicKeyPem, input.signature, 'base64');
      } else if (hmacKey) {
        const expected = crypto.createHmac('sha256', hmacKey).update(input.artifactDigest).digest('base64');
        const sigBuf = Buffer.from(input.signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length === expBuf.length) {
          valid = crypto.timingSafeEqual(sigBuf, expBuf);
        }
      } else {
        return {
          valid: false,
          artifactDigest: this.redactDigest(input.artifactDigest),
          signatureDigest: this.redactDigest(input.signature),
          failureReason: 'No verification key configured',
          verifiedAt,
          correlationId: input.correlationId,
        };
      }

      return {
        valid,
        artifactDigest: this.redactDigest(input.artifactDigest),
        signatureDigest: this.redactDigest(input.signature),
        failureReason: valid ? undefined : 'Signature verification failed',
        verifiedAt,
        correlationId: input.correlationId,
      };
    } catch (e) {
      return {
        valid: false,
        artifactDigest: this.redactDigest(input.artifactDigest),
        signatureDigest: this.redactDigest(input.signature),
        failureReason: `Verification error: ${(e as Error).message.slice(0, 200)}`,
        verifiedAt,
        correlationId: input.correlationId,
      };
    }
  }

  private redactDigest(digest: string): string {
    if (!digest) return '***MISSING***';
    if (digest.length <= 12) return '***REDACTED***';
    return `${digest.slice(0, 8)}...${digest.slice(-4)}`;
  }
}

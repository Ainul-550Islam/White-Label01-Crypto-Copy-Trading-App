// # Responsibility: provide a narrowly typed test-only loader for XML signature fixtures without importing DOM types.
/**
 * TEST-ONLY access to xml-crypto's SignedXml (used to produce genuinely
 * signed SAML responses for the specs).
 *
 * Loaded without its type declarations: xml-crypto's .d.ts imports
 * @xmldom/xmldom, whose .d.ts carries `/// <reference lib="dom" />`. Under
 * ts-jest, test files compiled in one process share a language service, so
 * that reference would leak the browser DOM lib into every later spec's
 * program and break Node-typed code (fetch Headers etc.). Only the surface the
 * specs use is typed here.
 */

import { createRequire } from 'node:module';

export interface SignedXmlInstance {
  canonicalizationAlgorithm: string;
  signatureAlgorithm: string;
  addReference(options: { xpath: string; digestAlgorithm: string; transforms: string[] }): void;
  computeSignature(
    xml: string,
    options?: {
      location?: { reference: string; action: 'append' | 'prepend' | 'before' | 'after' };
    },
  ): void;
  getSignedXml(): string;
}

export type SignedXmlConstructor = new (options: {
  privateKey: string;
  publicCert?: string;
}) => SignedXmlInstance;

const loadXmlCrypto = createRequire(__filename);
export const SignedXml: SignedXmlConstructor = (
  loadXmlCrypto('xml-crypto') as { SignedXml: SignedXmlConstructor }
).SignedXml;

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * TEST-ONLY SAML signing material, generated before every jest run by
 * test/sso-test-keys.global-setup.js (scripts/generate-test-sso-keys.mjs).
 * Nothing here is committed: the repository and its release archive contain no
 * private key. The directory is git-ignored.
 */
export const SSO_TEST_KEYS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.generated',
  'sso-test-keys',
);

const MARKER_FILE = '.wlct-generated-test-keys';

export interface SamlTestKeys {
  /** The "configured" IdP signing key and its self-signed certificate. */
  idpKey: string;
  idpCert: string;
  /** An unknown signer: everything it signs must be rejected. */
  attackerKey: string;
  attackerCert: string;
  /** A certificate valid only during 2020; configuration must ignore it. */
  expiredCert: string;
  /** The service provider's encryption pair (encrypted-assertion specs). */
  spEncKey: string;
  spEncCert: string;
}

function read(file: string): string {
  return readFileSync(join(SSO_TEST_KEYS_DIR, file), 'utf8');
}

/**
 * Loads the generated keys. Throws, rather than letting a SAML test skip or pass
 * vacuously, when the set is missing (for example when jest ran without the API
 * jest configuration's globalSetup, or OpenSSL is not installed).
 */
export function loadSamlTestKeys(): SamlTestKeys {
  const files = [
    'idp.key.pem',
    'idp.cert.pem',
    'attacker.key.pem',
    'attacker.cert.pem',
    'spenc.key.pem',
    'spenc.cert.pem',
    'expired.cert.pem',
  ];
  const missing = [MARKER_FILE, ...files].filter(
    (file) => !existsSync(join(SSO_TEST_KEYS_DIR, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Generated SAML test keys are missing in ${SSO_TEST_KEYS_DIR} (${missing.join(', ')}). ` +
        'They are created by the API jest globalSetup, which requires OpenSSL. ' +
        'Run `node scripts/generate-test-sso-keys.mjs` from the repository root, then rerun the tests.',
    );
  }
  return {
    idpKey: read('idp.key.pem'),
    idpCert: read('idp.cert.pem'),
    attackerKey: read('attacker.key.pem'),
    attackerCert: read('attacker.cert.pem'),
    expiredCert: read('expired.cert.pem'),
    spEncKey: read('spenc.key.pem'),
    spEncCert: read('spenc.cert.pem'),
  };
}

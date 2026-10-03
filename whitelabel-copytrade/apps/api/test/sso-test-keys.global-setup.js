/**
 * Jest globalSetup for the API unit tests: generates fresh TEST-ONLY SAML keys
 * before any spec runs.
 *
 * The SAML and SSO specs verify real XML-DSig signatures, so they need an RSA key
 * pair and certificates. The repository never contains a private key, so each
 * test run creates a new set with scripts/generate-test-sso-keys.mjs in
 * apps/api/.generated/sso-test-keys/ (git-ignored). The specs read the keys
 * through src/modules/security/__fixtures__/saml-test-keys.fixture-spec.ts.
 *
 * Requires OpenSSL on PATH. Without it the run stops here with the generator's
 * explanation: the SAML security tests are never skipped silently.
 *
 * Jest runs this once, in the parent process, before any worker starts, so
 * parallel workers all read one complete set.
 */
const { spawnSync } = require('child_process');
const path = require('path');

module.exports = async function generateSsoTestKeys() {
  const script = path.resolve(__dirname, '..', '..', '..', 'scripts', 'generate-test-sso-keys.mjs');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : String(result.stderr || '').trim() || `exit ${result.status}`;
    throw new Error(
      `Could not generate the test-only SAML keys required by the SSO specs.\n${reason}\n` +
        'Run `node scripts/generate-test-sso-keys.mjs` from the repository root to see the full error.',
    );
  }
};

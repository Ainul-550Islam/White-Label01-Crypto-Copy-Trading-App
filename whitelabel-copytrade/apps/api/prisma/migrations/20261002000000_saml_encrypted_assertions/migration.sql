-- Round 7: opt-in encrypted SAML assertions.
--
-- want_assertions_encrypted      when true the IdP must encrypt the assertion to the SP
--                                encryption certificate; a plaintext assertion is refused and
--                                the decrypted assertion must still carry a valid signature.
-- sp_decryption_key_ciphertext   the SP's RSA private key, envelope-encrypted by the API
--                                (AAD bound to the tenant); never returned by any API.
-- sp_encryption_certificate      the public certificate of that key, handed to the IdP.
--
-- Additive and nullable / defaulted: existing configurations keep their behaviour. No new
-- table, so the existing row-level security policies on sso_configurations apply unchanged.

ALTER TABLE "sso_configurations" ADD COLUMN "want_assertions_encrypted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sso_configurations" ADD COLUMN "sp_decryption_key_ciphertext" JSONB;
ALTER TABLE "sso_configurations" ADD COLUMN "sp_encryption_certificate" TEXT;

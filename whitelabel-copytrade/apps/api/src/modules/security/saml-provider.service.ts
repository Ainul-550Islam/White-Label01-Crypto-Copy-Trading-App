import { Injectable, Logger, Optional } from '@nestjs/common';
import { X509Certificate, createPrivateKey, verify as verifySignature } from 'crypto';
import { inflateRawSync } from 'zlib';
import { SAML, SamlStatusError, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { Prisma } from '@prisma/client';

import type { SealedPayload } from '@wlct/utils';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { ISsoProvider, SsoProviderMetadata, VerifiedSsoIdentity } from './sso-provider.interface';
import { SsoProvider } from './security.types';
import { SSO_TRANSACTION_TTL_SECONDS, SsoAuthError, SsoReasonCode, effectiveClockSkew, isAllowedSsoUrl } from './sso-flow.types';

/*
 * @xmldom/xmldom (the parser node-saml itself uses) is loaded WITHOUT its type
 * declarations: they start with `/// <reference lib="dom" />`, which would pull
 * the browser DOM lib into the whole API program and replace Node's
 * fetch/Headers types (breaking unrelated modules at build time). Only the
 * narrow, read-only surface below is used.
 */
interface XmlElement {
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  getElementsByTagNameNS(namespaceUri: string, localName: string): ArrayLike<XmlElement>;
}

interface XmlDocument {
  readonly documentElement: XmlElement | null;
}

interface XmlDomParserConstructor {
  new (options: {
    errorHandler: {
      warning: (msg: string) => void;
      error: (msg: string) => void;
      fatalError: (msg: string) => void;
    };
  }): { parseFromString(xml: string, mimeType: string): unknown };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { DOMParser } = require('@xmldom/xmldom') as { DOMParser: XmlDomParserConstructor };

const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
const NAMEID_UNSPECIFIED = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';

/** AAD binding the envelope-encrypted SP decryption key to its tenant. */
export function samlSpDecryptionKeyAad(tenantId: string): string {
  return `${tenantId}:sso:SAML:sp_decryption_key`;
}

/** AAD binding the envelope-encrypted SP signing key (Single Logout) to its tenant. */
export function samlSpSigningKeyAad(tenantId: string): string {
  return `${tenantId}:sso:SAML:sp_signing_key`;
}
const BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
const MAX_SAML_RESPONSE_CHARS = 400_000;
/** Logout messages arrive in a URL (HTTP-Redirect binding): small by construction. */
const MAX_LOGOUT_QUERY_CHARS = 16_384;
/** Upper bound for an inflated logout message (a deflate bomb is cut off here). */
const MAX_LOGOUT_XML_BYTES = 65_536;
/** SAML bindings 3.4.3: RelayState MUST NOT exceed 80 bytes. */
const MAX_RELAY_STATE_CHARS = 80;
/** Redirect-binding signature algorithms accepted on logout messages. SHA-1 is not accepted. */
const ACCEPTED_REDIRECT_SIG_ALGS: ReadonlySet<string> = new Set([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
]);
const NOOP_CACHE: CacheProvider = {
  saveAsync: async () => null,
  getAsync: async () => null,
  removeAsync: async () => null,
};

/**
 * What SAML Single Logout needs from a verified login: the NameID exactly as
 * the IdP issued it (value, format, qualifiers) and the IdP SessionIndex.
 * The NameID is personal data: it is only ever stored sealed.
 */
export interface SamlLogoutContext {
  nameID: string;
  nameIDFormat: string;
  nameQualifier?: string | null;
  spNameQualifier?: string | null;
  sessionIndex?: string | null;
}

/** A verified IdP-initiated LogoutRequest (HTTP-Redirect binding). */
export interface VerifiedSamlLogoutRequest {
  /** The request's ID; our LogoutResponse carries it as InResponseTo. */
  requestId: string;
  issuer: string;
  nameID: string;
  nameIDFormat: string | null;
  /** Every SessionIndex in the request; empty = all of the subject's sessions. */
  sessionIndexes: string[];
}

interface RedirectMessage {
  /** Decoded query parameters, exactly one of each allowed key. */
  container: Record<string, string>;
  root: XmlElement;
}

interface ClientExtras {
  decryptionPvk?: string;
  /** SP signing key: node-saml then signs every redirect message it builds (SigAlg + Signature). */
  privateKey?: string;
  logoutUrl?: string;
  logoutCallbackUrl?: string;
}

/** The subset of an SsoConfiguration row the SAML provider reads. */
export interface SamlConfigRecord {
  id: string;
  tenantId: string;
  providerType: string;
  state: string;
  isActive: boolean;
  /** IdP entity ID; the assertion Issuer must equal it exactly. */
  issuer: string | null;
  /** SP entity ID (preferred) - the expected Audience and the AuthnRequest Issuer. */
  entityId?: string | null;
  /** Fallback SP entity ID / expected Audience. */
  audience?: string | null;
  /** IdP SSO endpoint (HTTP-Redirect binding). */
  ssoUrl?: string | null;
  /** Our Assertion Consumer Service URL; Destination and Recipient must equal it. */
  acsUrl?: string | null;
  /** IdP signing certificate(s), PEM; several blocks allowed for rotation. */
  certificate?: string | null;
  clockSkewSec?: number | null;
  wantResponseSigned?: boolean | null;
  /** Opt-in: the assertion must arrive encrypted to spEncryptionCertificate. */
  wantAssertionsEncrypted?: boolean | null;
  /** Envelope-encrypted SP RSA private key (PEM) that decrypts the assertion. */
  spDecryptionKeyCiphertext?: unknown;
  /** Public certificate of that key (what the IdP encrypts to). */
  spEncryptionCertificate?: string | null;
  /** Single Logout: the IdP SingleLogoutService URL (HTTP-Redirect binding). */
  sloUrl?: string | null;
  /** Single Logout: our SingleLogoutService URL; Destination of IdP logout messages. */
  logoutCallbackUrl?: string | null;
  /** Single Logout: envelope-encrypted SP RSA signing key (PEM). */
  spSigningKeyCiphertext?: unknown;
  /** Single Logout: certificate of that key (the IdP verifies our messages with it). */
  spSigningCertificate?: string | null;
}

export interface VerifiedSamlAssertion {
  identity: VerifiedSsoIdentity;
  assertionId: string;
  /** When the assertion stops being valid; the replay record is kept until then. */
  notOnOrAfter: Date;
  /** NameID and SessionIndex of the signed assertion, for Single Logout. */
  logoutContext: SamlLogoutContext;
}

/**
 * SAML 2.0 service provider backed by @node-saml/node-saml (xml-crypto for
 * XML-DSig, @xmldom/xmldom for parsing).
 *
 * Fail-closed by construction:
 *  - disabled unless SSO_SAML_ENABLED=true AND the configuration is complete
 *    (IdP issuer, SSO URL, ACS URL, SP entity ID, at least one currently
 *    valid X.509 signing certificate);
 *  - the assertion must be signed (wantAssertionsSigned) by a configured
 *    certificate; the Response signature is additionally required when
 *    wantResponseSigned is set. node-saml extracts and processes only the
 *    XML covered by the verified signature and refuses multiple assertions,
 *    which is its defence against signature-wrapping;
 *  - Issuer, Audience, NotBefore / NotOnOrAfter (configured skew) and
 *    InResponseTo (must be this transaction's AuthnRequest ID; IdP-initiated
 *    SSO is refused) are checked by node-saml; Recipient (in the signed
 *    assertion) and Destination are checked here against the ACS URL;
 *  - documents with a DOCTYPE or ENTITY declaration are refused before
 *    parsing; certificates are never taken from the request;
 *  - each assertion ID is accepted once per tenant + issuer;
 *  - encrypted assertions are an opt-in per configuration
 *    (wantAssertionsEncrypted): node-saml decrypts the EncryptedAssertion
 *    with the tenant's SP key (xml-encryption) and then requires the
 *    signature INSIDE the decrypted assertion; with the opt-in set, a
 *    response carrying a plaintext assertion is refused before node-saml
 *    sees it. Without the opt-in no decryption key is loaded and an
 *    encrypted assertion is refused.
 *
 * Single Logout (round 8, HTTP-Redirect binding only), when the
 * configuration has the IdP SLO URL, our SLO URL and an SP signing pair:
 *  - SP-initiated: buildLogoutRequestUrl signs a LogoutRequest carrying the
 *    session's NameID and SessionIndex; verifyLogoutResponse accepts the
 *    IdP's answer only when it is signed by a configured IdP certificate,
 *    from the configured issuer, addressed to our SLO URL, in response to
 *    exactly the LogoutRequest ID the caller persisted, with status Success;
 *  - IdP-initiated: verifyLogoutRequest accepts a LogoutRequest only when it
 *    is signed, from the configured issuer, addressed to our SLO URL, fresh
 *    (IssueInstant), and its ID was not seen before; buildLogoutResponseUrl
 *    signs the answer;
 *  - node-saml alone would accept an unsigned redirect message (it verifies
 *    the signature only when one is present) and a LogoutResponse without
 *    InResponseTo, and it accepts SHA-1. Those cases are refused here,
 *    before or after node-saml runs.
 */
@Injectable()
export class SamlProviderService implements ISsoProvider {
  readonly providerType = SsoProvider.SAML;
  readonly providerName = 'SAML';
  private readonly logger = new Logger(SamlProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Needed only for the encrypted-assertion opt-in (to unseal the SP key).
    // A configuration that opts in while this is not wired fails closed with
    // CONFIG_INVALID; it never falls back to accepting plaintext.
    @Optional() private readonly crypto?: CryptoService,
  ) {}

  /** Deployment-level switch. SAML is off unless an operator turns it on. */
  isEnabled(): boolean {
    return process.env.SSO_SAML_ENABLED === 'true';
  }

  isAvailable(): boolean {
    return this.isEnabled();
  }

  async getMetadata(tenantId: string): Promise<SsoProviderMetadata> {
    const config = await this.loadConfig(tenantId);
    if (!config) {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_NOT_CONFIGURED, 'SAML is not configured for this tenant');
    }
    return {
      issuer: config.issuer || '',
      entityId: this.spEntityId(config) || '',
      ssoUrl: config.ssoUrl || '',
      acsUrl: config.acsUrl || '',
      certificate: config.certificate ? '[CERTIFICATE_PRESENT]' : undefined,
    };
  }

  /**
   * The provider-interface logout URL is an explicit refusal for SAML: a
   * SAML LogoutRequest names one session (NameID + SessionIndex) and must be
   * signed, so it cannot be built from a tenant id alone. Single Logout for a
   * session goes through POST /v1/auth/sso/logout-url, which calls
   * buildLogoutRequestUrl with that session's sealed logout context.
   */
  async getLogoutUrl(_tenantId: string, _redirectUri?: string): Promise<string> {
    throw new SsoAuthError(
      SsoReasonCode.CONFIG_INVALID,
      "SAML Single Logout needs the session's NameID and SessionIndex; use POST /v1/auth/sso/logout-url",
    );
  }

  /**
   * Refuses unless the configuration is usable for login AND for Single
   * Logout: https IdP SLO URL, https SP SLO URL, and an SP signing key whose
   * certificate is currently valid and belongs to it. Returns the IdP
   * certificates and the unsealed signing key.
   */
  assertSloUsable(config: SamlConfigRecord, now: Date = new Date()): { certs: string[]; signingKey: string } {
    const certs = this.assertConfigUsable(config, now);
    if (!config.sloUrl || !isAllowedSsoUrl(config.sloUrl)) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML IdP Single Logout URL (https) is not configured');
    }
    if (!config.logoutCallbackUrl || !isAllowedSsoUrl(config.logoutCallbackUrl)) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP Single Logout URL (https) is not configured');
    }
    if (!config.spSigningKeyCiphertext || !config.spSigningCertificate) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing key or certificate is not configured');
    }
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(config.spSigningCertificate);
    } catch {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing certificate is not a valid X.509 certificate');
    }
    if (!(new Date(certificate.validFrom) <= now && now <= new Date(certificate.validTo))) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing certificate is not currently valid');
    }
    if (!this.crypto) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing key is not available');
    }
    let signingKey: string;
    try {
      signingKey = this.crypto.decrypt(config.spSigningKeyCiphertext as SealedPayload, samlSpSigningKeyAad(config.tenantId));
    } catch {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing key cannot be decrypted');
    }
    let matches: boolean;
    try {
      matches = certificate.checkPrivateKey(createPrivateKey(signingKey));
    } catch {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing key is not a valid private key');
    }
    if (!matches) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_NOT_CONFIGURED, 'SAML SP signing certificate does not belong to the SP signing key');
    }
    return { certs, signingKey };
  }

  /**
   * SP-initiated Single Logout: the IdP SLO URL carrying a deflated, signed
   * (rsa-sha256, HTTP-Redirect binding) LogoutRequest with the given ID for
   * the session described by `context`. The caller persists `requestId` so
   * the LogoutResponse can be matched.
   */
  async buildLogoutRequestUrl(
    config: SamlConfigRecord,
    context: SamlLogoutContext,
    input: { requestId: string; relayState: string },
  ): Promise<string> {
    const { certs, signingKey } = this.assertSloUsable(config);
    if (!context || typeof context.nameID !== 'string' || context.nameID.length === 0) {
      throw new SsoAuthError(SsoReasonCode.SAML_SLO_CONTEXT_MISSING, 'The session has no SAML NameID');
    }
    const saml = this.client(config, certs, NOOP_CACHE, () => input.requestId, {
      privateKey: signingKey,
      logoutUrl: String(config.sloUrl),
      logoutCallbackUrl: String(config.logoutCallbackUrl),
    });
    const profile: Profile = {
      issuer: String(config.issuer),
      nameID: context.nameID,
      nameIDFormat: context.nameIDFormat || NAMEID_UNSPECIFIED,
      ...(context.nameQualifier ? { nameQualifier: context.nameQualifier } : {}),
      ...(context.spNameQualifier ? { spNameQualifier: context.spNameQualifier } : {}),
      ...(context.sessionIndex ? { sessionIndex: context.sessionIndex } : {}),
    };
    return saml.getLogoutUrlAsync(profile, input.relayState, {});
  }

  /**
   * Verifies the IdP's LogoutResponse to our LogoutRequest `expectedRequestId`
   * (HTTP-Redirect binding; `rawQuery` is the query string exactly as
   * received, because the signature covers its encoded bytes). Throws
   * SsoAuthError unless it is signed by a configured IdP certificate with an
   * accepted algorithm, comes from the configured issuer, is addressed to our
   * SLO URL, answers exactly that request and reports Success.
   */
  async verifyLogoutResponse(
    config: SamlConfigRecord,
    input: { rawQuery: string; expectedRequestId: string },
  ): Promise<void> {
    const { certs } = this.assertSloUsable(config);
    const message = this.parseRedirectMessage(input.rawQuery, 'SAMLResponse');
    const cache: CacheProvider = {
      saveAsync: async () => null,
      getAsync: async (key: string) => (input.expectedRequestId && key === input.expectedRequestId ? new Date().toISOString() : null),
      removeAsync: async () => null,
    };
    await this.validateRedirect(config, certs, cache, message, input.rawQuery);

    // Signed content only from here on (the redirect signature covers the whole SAMLResponse).
    const inResponseTo = message.root.getAttribute('InResponseTo');
    if (!inResponseTo || !input.expectedRequestId || inResponseTo !== input.expectedRequestId) {
      throw new SsoAuthError(SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH, 'LogoutResponse does not answer this LogoutRequest');
    }
    this.assertLogoutDestination(config, message.root);
    this.assertLogoutIssuer(config, message.root);
    const statusCode = message.root.getElementsByTagNameNS(SAML_PROTOCOL_NS, 'StatusCode')[0];
    if (!statusCode || statusCode.getAttribute('Value') !== STATUS_SUCCESS) {
      throw new SsoAuthError(SsoReasonCode.SAML_STATUS_NOT_SUCCESS, 'IdP did not report a successful logout');
    }
  }

  /**
   * Verifies an IdP-initiated LogoutRequest (HTTP-Redirect binding) and
   * records its ID once per tenant + issuer (replay protection). Throws
   * SsoAuthError unless it is signed by a configured IdP certificate with an
   * accepted algorithm, comes from the configured issuer, is addressed to our
   * SLO URL, was issued within the transaction lifetime (plus the configured
   * clock skew) and names a subject.
   */
  async verifyLogoutRequest(
    config: SamlConfigRecord,
    input: { rawQuery: string; now?: Date },
  ): Promise<VerifiedSamlLogoutRequest> {
    const now = input.now ?? new Date();
    const { certs } = this.assertSloUsable(config, now);
    const message = this.parseRedirectMessage(input.rawQuery, 'SAMLRequest');
    await this.validateRedirect(config, certs, NOOP_CACHE, message, input.rawQuery);

    // Signed content only from here on (the redirect signature covers the whole SAMLRequest).
    const root = message.root;
    const requestId = root.getAttribute('ID');
    if (!requestId || requestId.length > 200) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'LogoutRequest ID missing or too long');
    }
    this.assertLogoutDestination(config, root);
    const issuer = this.assertLogoutIssuer(config, root);

    const skewMs = effectiveClockSkew(config.clockSkewSec) * 1000;
    const issueInstant = new Date(root.getAttribute('IssueInstant') ?? '');
    if (Number.isNaN(issueInstant.getTime())) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'LogoutRequest IssueInstant missing or invalid');
    }
    if (issueInstant.getTime() - now.getTime() > skewMs) {
      throw new SsoAuthError(SsoReasonCode.SAML_EXPIRED, 'LogoutRequest is not yet valid');
    }
    if (now.getTime() - issueInstant.getTime() > SSO_TRANSACTION_TTL_SECONDS * 1000 + skewMs) {
      throw new SsoAuthError(SsoReasonCode.SAML_EXPIRED, 'LogoutRequest is too old');
    }

    if (root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'EncryptedID').length > 0) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Encrypted NameID in LogoutRequest is not supported');
    }
    const nameIdElement = root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'NameID')[0];
    const nameID = (nameIdElement?.textContent ?? '').trim();
    if (!nameIdElement || !nameID || nameID.length > 512) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'LogoutRequest NameID missing or too long');
    }
    const sessionIndexes = Array.from(root.getElementsByTagNameNS(SAML_PROTOCOL_NS, 'SessionIndex'))
      .map((element) => (element.textContent ?? '').trim())
      .filter((value) => value.length > 0 && value.length <= 1024)
      .slice(0, 50);

    // A colon cannot occur in an xsd:ID, so these keys never collide with assertion IDs.
    await this.recordAssertionOnce(
      config.tenantId,
      issuer,
      `LogoutRequest:${requestId}`,
      new Date(issueInstant.getTime() + SSO_TRANSACTION_TTL_SECONDS * 1000 + skewMs),
    );

    return {
      requestId,
      issuer,
      nameID,
      nameIDFormat: nameIdElement.getAttribute('Format'),
      sessionIndexes,
    };
  }

  /**
   * The IdP SLO URL carrying our signed LogoutResponse (status Success) to a
   * verified IdP-initiated LogoutRequest.
   */
  async buildLogoutResponseUrl(
    config: SamlConfigRecord,
    input: { inResponseTo: string; relayState: string | null; responseId: string },
  ): Promise<string> {
    const { certs, signingKey } = this.assertSloUsable(config);
    const saml = this.client(config, certs, NOOP_CACHE, () => input.responseId, {
      privateKey: signingKey,
      logoutUrl: String(config.sloUrl),
      logoutCallbackUrl: String(config.logoutCallbackUrl),
    });
    const request: Profile = { ID: input.inResponseTo, issuer: String(config.issuer), nameID: '', nameIDFormat: '' };
    return saml.getLogoutResponseUrlAsync(request, input.relayState ?? '', {}, true);
  }

  /**
   * Refuses unless SAML is enabled for the deployment and the configuration
   * is complete and its signing certificate(s) are currently valid.
   */
  assertConfigUsable(config: SamlConfigRecord, now: Date = new Date()): string[] {
    if (!this.isEnabled()) {
      throw new SsoAuthError(SsoReasonCode.SAML_DISABLED, 'SAML is disabled for this deployment (SSO_SAML_ENABLED is not true)');
    }
    if (config.providerType !== 'SAML') {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_MISMATCH, 'Configuration is not a SAML provider');
    }
    if (!config.isActive || config.state === 'DISABLED') {
      throw new SsoAuthError(SsoReasonCode.PROVIDER_DISABLED, 'SAML provider is disabled');
    }
    if (!config.issuer) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML IdP issuer (entity ID) is not configured');
    }
    if (!this.spEntityId(config)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML SP entity ID (audience) is not configured');
    }
    if (!config.ssoUrl || !isAllowedSsoUrl(config.ssoUrl)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML IdP SSO URL must be an https URL');
    }
    if (!config.acsUrl || !isAllowedSsoUrl(config.acsUrl)) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML ACS URL must be an https URL');
    }
    if (config.wantAssertionsEncrypted === true && (!config.spDecryptionKeyCiphertext || !config.spEncryptionCertificate)) {
      throw new SsoAuthError(
        SsoReasonCode.CONFIG_INVALID,
        'Encrypted assertions are required but the SP decryption key or encryption certificate is not configured',
      );
    }
    return this.signingCertificates(config.certificate, now);
  }

  /**
   * Parses the configured certificate text into PEM certificates that are
   * valid right now. Throws CONFIG_INVALID when none is usable.
   */
  signingCertificates(certificateText: string | null | undefined, now: Date = new Date()): string[] {
    if (!certificateText || certificateText.trim().length === 0) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML IdP signing certificate is not configured');
    }
    const blocks = certificateText.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    const candidates = blocks.length > 0 ? blocks : [this.wrapPem(certificateText)];
    const usable: string[] = [];
    for (const pem of candidates) {
      let cert: X509Certificate;
      try {
        cert = new X509Certificate(pem);
      } catch {
        throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML IdP signing certificate is not a valid X.509 certificate');
      }
      if (new Date(cert.validFrom) <= now && now <= new Date(cert.validTo)) {
        usable.push(cert.toString());
      }
    }
    if (usable.length === 0) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'No SAML IdP signing certificate is currently valid');
    }
    return usable;
  }

  /** The IdP redirect URL carrying a deflated AuthnRequest with the given ID and RelayState. */
  async buildAuthorizationUrl(config: SamlConfigRecord, input: { relayState: string; requestId: string }): Promise<string> {
    const certs = this.assertConfigUsable(config);
    const saml = this.client(config, certs, NOOP_CACHE, () => input.requestId);
    return saml.getAuthorizeUrlAsync(input.relayState, undefined, {});
  }

  /**
   * Cryptographically verifies a SAMLResponse for one transaction and records
   * the assertion ID (replay protection). Throws SsoAuthError on any failure.
   */
  async verifyResponse(
    config: SamlConfigRecord,
    input: { samlResponse: string; expectedRequestId: string },
  ): Promise<VerifiedSamlAssertion> {
    const certs = this.assertConfigUsable(config);

    if (typeof input.samlResponse !== 'string' || input.samlResponse.length === 0 || input.samlResponse.length > MAX_SAML_RESPONSE_CHARS) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'SAMLResponse missing or too large');
    }
    const xml = Buffer.from(input.samlResponse, 'base64').toString('utf8');
    if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'SAMLResponse contains a DTD or entity declaration');
    }

    const cache: CacheProvider = {
      saveAsync: async () => null,
      getAsync: async (key: string) => (key === input.expectedRequestId ? new Date().toISOString() : null),
      removeAsync: async () => null,
    };
    let decryptionPvk: string | undefined;
    if (config.wantAssertionsEncrypted === true) {
      this.assertAssertionEncrypted(xml);
      decryptionPvk = this.spDecryptionKey(config);
    }
    const saml = this.client(config, certs, cache, () => input.expectedRequestId, decryptionPvk ? { decryptionPvk } : {});

    let profile: Profile | null;
    try {
      const result = await saml.validatePostResponseAsync({ SAMLResponse: input.samlResponse });
      profile = result.profile;
    } catch (error) {
      throw this.mapSamlError(error);
    }
    if (!profile || typeof profile.getAssertionXml !== 'function') {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'SAMLResponse carried no assertion');
    }

    const acsUrl = String(config.acsUrl);

    // Destination on the Response (when present) must be our ACS.
    const responseXml = typeof profile.getSamlResponseXml === 'function' ? profile.getSamlResponseXml() : xml;
    const responseDoc = this.parse(responseXml);
    const destination = responseDoc.documentElement?.getAttribute('Destination');
    if (destination && destination !== acsUrl) {
      throw new SsoAuthError(SsoReasonCode.SAML_DESTINATION_MISMATCH, 'SAML Response Destination is not this ACS');
    }

    // Everything below reads the SIGNED assertion only.
    const assertionDoc = this.parse(profile.getAssertionXml());
    const assertion = assertionDoc.documentElement;
    if (!assertion || assertion.localName !== 'Assertion') {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Verified XML is not an Assertion');
    }
    const assertionId = assertion.getAttribute('ID');
    if (!assertionId || assertionId.length > 256) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Assertion ID missing');
    }

    // Recipient: a bearer SubjectConfirmationData must name our ACS.
    const confirmations = Array.from(assertion.getElementsByTagNameNS(SAML_ASSERTION_NS, 'SubjectConfirmation'));
    const recipientOk = confirmations.some((sc) => {
      if (sc.getAttribute('Method') !== BEARER) return false;
      const data = sc.getElementsByTagNameNS(SAML_ASSERTION_NS, 'SubjectConfirmationData')[0];
      return !!data && data.getAttribute('Recipient') === acsUrl;
    });
    if (!recipientOk) {
      throw new SsoAuthError(SsoReasonCode.SAML_RECIPIENT_MISMATCH, 'No bearer SubjectConfirmationData names this ACS as Recipient');
    }

    const conditions = assertion.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Conditions')[0];
    const notOnOrAfterRaw = conditions?.getAttribute('NotOnOrAfter');
    const notOnOrAfter = notOnOrAfterRaw ? new Date(notOnOrAfterRaw) : null;
    if (!notOnOrAfter || Number.isNaN(notOnOrAfter.getTime())) {
      throw new SsoAuthError(SsoReasonCode.SAML_EXPIRED, 'Assertion Conditions has no NotOnOrAfter');
    }

    const issuer = typeof profile.issuer === 'string' ? profile.issuer : '';
    if (issuer !== config.issuer) {
      throw new SsoAuthError(SsoReasonCode.SAML_ISSUER_MISMATCH, 'Assertion issuer is not the configured IdP');
    }
    const subject = typeof profile.nameID === 'string' ? profile.nameID : '';
    if (!subject || subject.length > 512) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Assertion NameID missing or too long');
    }

    await this.recordAssertionOnce(config.tenantId, issuer, assertionId, notOnOrAfter);

    const email = this.extractEmail(profile);
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : undefined);
    const groupsRaw = profile['groups'] ?? profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'];
    const groups = Array.isArray(groupsRaw) ? groupsRaw.filter((g): g is string => typeof g === 'string').slice(0, 100) : undefined;

    this.logger.log(`SAML assertion verified tenant=${config.tenantId}`);

    const sessionIndex = typeof profile.sessionIndex === 'string' && profile.sessionIndex.length > 0 && profile.sessionIndex.length <= 1024
      ? profile.sessionIndex
      : null;

    return {
      assertionId,
      notOnOrAfter,
      logoutContext: {
        nameID: subject,
        nameIDFormat: typeof profile.nameIDFormat === 'string' && profile.nameIDFormat.length > 0 ? profile.nameIDFormat : NAMEID_UNSPECIFIED,
        nameQualifier: typeof profile.nameQualifier === 'string' && profile.nameQualifier.length > 0 ? profile.nameQualifier : null,
        spNameQualifier: typeof profile.spNameQualifier === 'string' && profile.spNameQualifier.length > 0 ? profile.spNameQualifier : null,
        sessionIndex,
      },
      identity: {
        providerType: SsoProvider.SAML,
        issuer,
        subject,
        email,
        // The tenant's own IdP, pinned by its signing certificate, vouches for the address.
        emailVerified: email !== null,
        displayName: str(profile['displayName']),
        firstName: str(profile['firstName'] ?? profile['givenName']),
        lastName: str(profile['lastName'] ?? profile['surname']),
        groups,
      },
    };
  }

  /** Inserts the assertion ID; a duplicate is a replay. */
  async recordAssertionOnce(tenantId: string, issuer: string, assertionId: string, notOnOrAfter: Date): Promise<void> {
    try {
      await this.prisma.ssoAssertionReplay.create({
        data: { tenantId, issuer, assertionId, expiresAt: notOnOrAfter },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new SsoAuthError(SsoReasonCode.SAML_REPLAY, 'Assertion ID already used');
      }
      throw error;
    }
  }

  /**
   * With the encrypted-assertion opt-in, the response must carry exactly one
   * EncryptedAssertion and no plaintext Assertion anywhere. Checked on the raw
   * document before node-saml runs, because node-saml itself accepts either.
   */
  private assertAssertionEncrypted(xml: string): void {
    const root = this.parse(xml).documentElement;
    const plaintext = root ? root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Assertion').length : 0;
    const encrypted = root ? root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'EncryptedAssertion').length : 0;
    if (plaintext > 0 || encrypted !== 1) {
      throw new SsoAuthError(
        SsoReasonCode.SAML_ASSERTION_NOT_ENCRYPTED,
        'This configuration requires an encrypted assertion',
      );
    }
  }

  /** Unseals the tenant's SP decryption key; any failure is a configuration error. */
  private spDecryptionKey(config: SamlConfigRecord): string {
    if (!config.spDecryptionKeyCiphertext || !this.crypto) {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML SP decryption key is not available');
    }
    try {
      return this.crypto.decrypt(config.spDecryptionKeyCiphertext as SealedPayload, samlSpDecryptionKeyAad(config.tenantId));
    } catch {
      throw new SsoAuthError(SsoReasonCode.CONFIG_INVALID, 'SAML SP decryption key cannot be decrypted');
    }
  }

  /**
   * HTTP-Redirect logout message checks that come before node-saml:
   * only the binding's parameters, each exactly once; the message and both
   * Signature and SigAlg present (node-saml would accept an unsigned
   * message); an accepted algorithm; bounded size; no DTD / entity
   * declaration; the expected root element in the SAML protocol namespace.
   */
  private parseRedirectMessage(rawQuery: string, kind: 'SAMLRequest' | 'SAMLResponse'): RedirectMessage {
    if (typeof rawQuery !== 'string' || rawQuery.length === 0 || rawQuery.length > MAX_LOGOUT_QUERY_CHARS) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Logout message missing or too large');
    }
    const allowed = new Set<string>([kind, 'RelayState', 'SigAlg', 'Signature']);
    const container: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(rawQuery)) {
      if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(container, key)) {
        throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Unexpected or repeated logout message parameter');
      }
      container[key] = value;
    }
    if (!container[kind]) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, `${kind} missing`);
    }
    if (!container.Signature || !container.SigAlg) {
      throw new SsoAuthError(SsoReasonCode.SAML_SIGNATURE_INVALID, 'Logout message is not signed (Signature and SigAlg are required)');
    }
    if (!ACCEPTED_REDIRECT_SIG_ALGS.has(container.SigAlg)) {
      throw new SsoAuthError(SsoReasonCode.SAML_SIGNATURE_INVALID, 'Logout message signature algorithm is not accepted');
    }
    if (container.RelayState !== undefined && container.RelayState.length > MAX_RELAY_STATE_CHARS) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'RelayState is longer than 80 bytes');
    }
    let inflated: Buffer;
    try {
      inflated = inflateRawSync(Buffer.from(container[kind], 'base64'), { maxOutputLength: MAX_LOGOUT_XML_BYTES });
    } catch {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Logout message could not be inflated');
    }
    const xml = inflated.toString('utf8');
    if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'Logout message contains a DTD or entity declaration');
    }
    const root = this.parse(xml).documentElement;
    const expectedRoot = kind === 'SAMLRequest' ? 'LogoutRequest' : 'LogoutResponse';
    if (!root || root.localName !== expectedRoot || root.namespaceURI !== SAML_PROTOCOL_NS) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, `Logout message is not a ${expectedRoot}`);
    }
    return { container, root };
  }

  /**
   * Redirect-binding signature first (so nothing in an unauthenticated
   * message, such as its status, decides the outcome or the recorded reason),
   * then node-saml: the signature again, issuer, status, timestamps.
   */
  private async validateRedirect(
    config: SamlConfigRecord,
    certs: string[],
    cache: CacheProvider,
    message: RedirectMessage,
    rawQuery: string,
  ): Promise<void> {
    this.assertRedirectSignature(certs, message, rawQuery);
    const saml = this.client(config, certs, cache, () => '_unused');
    try {
      await saml.validateRedirectAsync(message.container as unknown as Parameters<SAML['validateRedirectAsync']>[0], rawQuery);
    } catch (error) {
      throw this.mapSamlError(error);
    }
  }

  /**
   * SAML bindings 3.4.4.1: the signature covers
   * `SAMLRequest|SAMLResponse=v[&RelayState=v]&SigAlg=v` exactly as received
   * (URL-encoded). Tokens are matched by exact key (parseRedirectMessage has
   * already refused unknown or repeated keys); verified against every
   * currently valid configured IdP certificate.
   */
  private assertRedirectSignature(certs: string[], message: RedirectMessage, rawQuery: string): void {
    const tokens = rawQuery.split('&');
    const token = (key: string): string | undefined => tokens.find((candidate) => candidate.startsWith(`${key}=`));
    const kind = message.container.SAMLRequest !== undefined ? 'SAMLRequest' : 'SAMLResponse';
    const messageToken = token(kind);
    const relayToken = token('RelayState');
    const sigAlgToken = token('SigAlg');
    if (!messageToken || !sigAlgToken) {
      throw new SsoAuthError(SsoReasonCode.SAML_SIGNATURE_INVALID, 'Logout message signature input is incomplete');
    }
    const signedInput = Buffer.from([messageToken, ...(relayToken ? [relayToken] : []), sigAlgToken].join('&'), 'utf8');
    const algorithm = message.container.SigAlg.endsWith('#rsa-sha512') ? 'sha512' : 'sha256';
    const signature = Buffer.from(message.container.Signature, 'base64');
    const valid = certs.some((pem) => verifySignature(algorithm, signedInput, pem, signature));
    if (!valid) {
      throw new SsoAuthError(SsoReasonCode.SAML_SIGNATURE_INVALID, 'Logout message signature is not from the configured IdP');
    }
  }

  /** SAML bindings 3.4.5.2: a signed message MUST carry Destination; it must be our SLO URL. */
  private assertLogoutDestination(config: SamlConfigRecord, root: XmlElement): void {
    const destination = root.getAttribute('Destination');
    if (!destination || destination !== config.logoutCallbackUrl) {
      throw new SsoAuthError(SsoReasonCode.SAML_DESTINATION_MISMATCH, 'Logout message Destination is not this SLO endpoint');
    }
  }

  /** The Issuer child must be the configured IdP entity ID. Returns it. */
  private assertLogoutIssuer(config: SamlConfigRecord, root: XmlElement): string {
    const issuerElement = root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Issuer')[0];
    const issuer = (issuerElement?.textContent ?? '').trim();
    if (!issuer || issuer !== config.issuer) {
      throw new SsoAuthError(SsoReasonCode.SAML_ISSUER_MISMATCH, 'Logout message issuer is not the configured IdP');
    }
    return issuer;
  }

  private client(
    config: SamlConfigRecord,
    certs: string[],
    cacheProvider: CacheProvider,
    generateUniqueId: () => string,
    extras: ClientExtras = {},
  ): SAML {
    const skewMs = effectiveClockSkew(config.clockSkewSec) * 1000;
    return new SAML({
      ...(extras.decryptionPvk ? { decryptionPvk: extras.decryptionPvk } : {}),
      ...(extras.privateKey ? { privateKey: extras.privateKey } : {}),
      ...(extras.logoutUrl ? { logoutUrl: extras.logoutUrl } : {}),
      ...(extras.logoutCallbackUrl ? { logoutCallbackUrl: extras.logoutCallbackUrl } : {}),
      callbackUrl: String(config.acsUrl),
      entryPoint: String(config.ssoUrl),
      issuer: String(this.spEntityId(config)),
      audience: String(this.spEntityId(config)),
      idpCert: certs,
      idpIssuer: String(config.issuer),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: config.wantResponseSigned === true,
      acceptedClockSkewMs: skewMs,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SSO_TRANSACTION_TTL_SECONDS * 1000,
      cacheProvider,
      generateUniqueId,
      signatureAlgorithm: 'sha256',
      disableRequestedAuthnContext: true,
    });
  }

  private mapSamlError(error: unknown): SsoAuthError {
    if (error instanceof SsoAuthError) return error;
    if (error instanceof SamlStatusError) {
      return new SsoAuthError(SsoReasonCode.SAML_STATUS_NOT_SUCCESS, 'IdP returned a non-success SAML status');
    }
    const message = String((error as Error)?.message ?? '');
    // node-saml's LogoutResponse status check.
    if (/^Bad status code/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_STATUS_NOT_SUCCESS, 'IdP returned a non-success SAML status');
    }
    if (/signature|Cannot obtain assertion from signed data/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_SIGNATURE_INVALID, 'SAML signature verification failed');
    }
    if (/SAML issuer/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_ISSUER_MISMATCH, 'SAML issuer is not the configured IdP');
    }
    if (/audience|AudienceRestriction/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_AUDIENCE_MISMATCH, 'SAML audience mismatch');
    }
    // node-saml filters SubjectConfirmationData by its time window only, so
    // "no valid subject confirmation" means every confirmation was outside it.
    if (/expired|not yet valid|No valid subject confirmation/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_EXPIRED, 'SAML assertion outside its validity window');
    }
    if (/InResponseTo/i.test(message)) {
      return new SsoAuthError(SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH, 'SAML InResponseTo does not match this login');
    }
    return new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'SAMLResponse could not be processed');
  }

  private parse(xml: string): XmlDocument {
    const errors: string[] = [];
    const doc = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: (msg: string) => errors.push(msg),
        fatalError: (msg: string) => errors.push(msg),
      },
    }).parseFromString(xml, 'text/xml') as XmlDocument | null;
    if (errors.length > 0 || !doc || !doc.documentElement) {
      throw new SsoAuthError(SsoReasonCode.SAML_MALFORMED, 'SAML XML could not be parsed');
    }
    return doc;
  }

  private extractEmail(profile: Profile): string | null {
    const candidates: unknown[] = [
      profile.email,
      profile.mail,
      profile['urn:oid:0.9.2342.19200300.100.1.3'],
      profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    ];
    if (typeof profile.nameIDFormat === 'string' && profile.nameIDFormat.endsWith(':emailAddress')) {
      candidates.push(profile.nameID);
    }
    for (const value of candidates) {
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v === 'string' && v.includes('@') && v.length <= 254) return v.trim().toLowerCase();
    }
    return null;
  }

  private spEntityId(config: SamlConfigRecord): string | null {
    return config.entityId || config.audience || null;
  }

  private wrapPem(body: string): string {
    const clean = body.replace(/[\s\r\n]+/g, '');
    const lines = clean.match(/.{1,64}/g) ?? [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
  }

  private async loadConfig(tenantId: string): Promise<SamlConfigRecord | null> {
    return (await this.prisma.ssoConfiguration.findFirst({
      where: { tenantId, providerType: 'SAML', isActive: true },
    })) as SamlConfigRecord | null;
  }
}

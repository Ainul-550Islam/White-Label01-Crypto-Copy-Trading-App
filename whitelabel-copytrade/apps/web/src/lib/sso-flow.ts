import { z } from "zod";

/**
 * Single sign-on (Part 11) - pure helpers shared by the BFF routes
 * /api/auth/sso/start and /api/auth/sso/callback.
 *
 * The browser never sees the binding secret, the device id, any IdP code or
 * any platform token:
 *  - start: the BFF asks the API for an authorization URL and keeps the
 *    returned binding secret and the generated device id in httpOnly cookies
 *    scoped to /api/auth/sso;
 *  - callback: the IdP redirects the browser to the BFF, which completes the
 *    login server-to-server with state + code + the two cookies, then stores
 *    the session exactly like password login (or the 2FA challenge cookies).
 *
 * The binding cookies are SameSite=Lax (not Strict) on purpose: the IdP's
 * redirect back is a cross-site top-level navigation, on which Strict
 * cookies are not sent. They are httpOnly, short-lived, path-scoped and
 * deleted on the first callback; possession alone is useless without the
 * matching server-side transaction, which is single-use.
 */

export const SSO_BINDING_COOKIE = "wlct_sso_bind";
export const SSO_DEVICE_COOKIE = "wlct_sso_did";
export const SSO_COOKIE_PATH = "/api/auth/sso";
export const SSO_DEFAULT_RETURN = "/dashboard";
/** Upper bound for the binding cookies, matching the API transaction TTL (600 s). */
export const SSO_COOKIE_MAX_AGE = 600;

/** Same rule as the API (isSafeReturnTo): an app-relative path only. */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !/^\/[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * Browser -> BFF body for POST /api/auth/sso/start. No tenant id: the tenant
 * is the request host. providerType is optional: without it the API starts
 * the tenant's enabled provider (OIDC or SAML).
 */
export const ssoStartRequestSchema = z
  .object({
    providerType: z.enum(["OIDC", "SAML"]).optional(),
    returnTo: z
      .string()
      .max(512)
      .refine((v) => isSafeReturnPath(v), {
        message: "returnTo must be an app-relative path",
      })
      .optional(),
  })
  .strict();

export type SsoStartRequest = z.infer<typeof ssoStartRequestSchema>;

/** API response of POST /v1/auth/sso/start. */
export interface SsoStartApiResult {
  providerType: "OIDC" | "SAML";
  authorizationUrl: string;
  bindingToken: string;
  expiresIn: number;
}

/** Only https IdP URLs are handed to the browser (plain http only for loopback outside production). */
export function isAcceptableAuthorizationUrl(
  raw: string,
  production: boolean,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    !production &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

const MAX_PARAM = 4096;

function param(query: URLSearchParams, name: string): string | null {
  const value = query.get(name);
  if (value === null || value.length === 0 || value.length > MAX_PARAM)
    return null;
  return value;
}

/**
 * BFF -> API body for POST /v1/auth/sso/callback (SsoCallbackDto). Only the
 * whitelisted fields are forwarded (the DTO rejects extras with 422); the
 * binding secret and device id come from the httpOnly cookies, never from
 * the query string. Returns null when the redirect cannot be a valid callback.
 */
export function buildSsoCallbackBody(
  query: URLSearchParams,
  bindingToken: string | undefined,
  deviceId: string | undefined,
): Record<string, string> | null {
  const state = param(query, "state");
  if (!state || !bindingToken || !deviceId) return null;
  const code = param(query, "code");
  const error = param(query, "error");
  if (!code && !error) return null;
  const body: Record<string, string> = {
    state,
    bindingToken,
    deviceId,
    deviceName: "Customer Web",
    platform: "web",
  };
  if (code) body.code = code;
  if (error) body.error = error.slice(0, 128);
  return body;
}

/** Where the browser goes after a refused or failed SSO attempt (no detail: refusals are generic). */
export const SSO_FAILURE_PATH = "/login?sso=failed";
/** Where the browser goes when the account requires its second factor (challenge cookies already set). */
export const SSO_MFA_PATH = "/login?sso=mfa";

/** The post-login target: the server-validated returnTo when safe, else the dashboard. */
export function ssoSuccessPath(returnTo: unknown): string {
  return isSafeReturnPath(returnTo) ? returnTo : SSO_DEFAULT_RETURN;
}

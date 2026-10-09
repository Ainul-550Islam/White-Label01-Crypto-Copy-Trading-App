import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverFetch } from "@/lib/server-api";
import { persistSession, type SessionTokens } from "@/lib/session";
import {
  SSO_BINDING_COOKIE,
  SSO_COOKIE_PATH,
  SSO_DEVICE_COOKIE,
  SSO_FAILURE_PATH,
  SSO_MFA_PATH,
  buildSsoCallbackBody,
  ssoSuccessPath,
} from "@/lib/sso-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SessionPayload {
  tokens: SessionTokens;
  user: { id: string; email: string };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

interface SsoCompleteApiResult {
  result: SessionPayload | ChallengePayload;
  returnTo: string | null;
}

function redirectTo(request: Request, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * GET /api/auth/sso/callback - the redirect URI registered at the IdP (and
 * the SAML hand-off target). Completes the login server-to-server and
 * stores the session in httpOnly cookies; the code and state never reach
 * browser JavaScript, and no token is ever put in a URL.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const store = await cookies();
  const bindingToken = store.get(SSO_BINDING_COOKIE)?.value;
  const deviceId = store.get(SSO_DEVICE_COOKIE)?.value;
  // One attempt per start: the binding cookies are dropped whatever happens next.
  store.set(SSO_BINDING_COOKIE, "", {
    httpOnly: true,
    path: SSO_COOKIE_PATH,
    maxAge: 0,
  });
  store.set(SSO_DEVICE_COOKIE, "", {
    httpOnly: true,
    path: SSO_COOKIE_PATH,
    maxAge: 0,
  });

  const query = new URL(request.url).searchParams;
  const body = buildSsoCallbackBody(query, bindingToken, deviceId);
  if (!body || !deviceId) {
    return redirectTo(request, SSO_FAILURE_PATH);
  }

  try {
    const completed = await serverFetch<SsoCompleteApiResult>(
      "/auth/sso/callback",
      {
        method: "POST",
        authenticated: false,
        body,
        host: request.headers.get("host") ?? undefined,
      },
    );
    const result = completed?.result;
    if (!result) {
      return redirectTo(request, SSO_FAILURE_PATH);
    }

    if ("twoFactorRequired" in result && result.twoFactorRequired) {
      const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: result.expiresIn,
      };
      store.set("wlct_2fa", result.challengeToken, options);
      store.set("wlct_2fa_did", deviceId, options);
      return redirectTo(request, SSO_MFA_PATH);
    }

    if (!("tokens" in result) || !result.tokens) {
      return redirectTo(request, SSO_FAILURE_PATH);
    }
    await persistSession(result.tokens, deviceId, randomUUID());
    return redirectTo(request, ssoSuccessPath(completed.returnTo));
  } catch {
    // Refusals are generic by design (the API recorded the specific reason in its audit trail).
    return redirectTo(request, SSO_FAILURE_PATH);
  }
}

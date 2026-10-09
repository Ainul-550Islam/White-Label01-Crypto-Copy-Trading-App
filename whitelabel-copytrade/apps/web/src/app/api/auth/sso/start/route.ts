import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@wlct/utils/api-error";
import { serverFetch } from "@/lib/server-api";
import {
  SSO_BINDING_COOKIE,
  SSO_COOKIE_MAX_AGE,
  SSO_COOKIE_PATH,
  SSO_DEVICE_COOKIE,
  isAcceptableAuthorizationUrl,
  ssoStartRequestSchema,
  type SsoStartApiResult,
} from "@/lib/sso-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sso/start - begins a single sign-on login for the tenant of
 * this host. Returns only the IdP URL to navigate to; the binding secret and
 * the device id stay in httpOnly cookies for the callback.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "A JSON body is required.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = ssoStartRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The single sign-on request is invalid.",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const deviceId = `web-${randomUUID()}`;
  const host = request.headers.get("host") ?? undefined;
  const production = process.env.NODE_ENV === "production";

  try {
    const result = await serverFetch<SsoStartApiResult>("/auth/sso/start", {
      method: "POST",
      authenticated: false,
      body: {
        ...(parsed.data.providerType ? { providerType: parsed.data.providerType } : {}),
        deviceId,
        ...(parsed.data.returnTo ? { returnTo: parsed.data.returnTo } : {}),
      },
      host,
    });

    if (
      !result ||
      typeof result.bindingToken !== "string" ||
      !isAcceptableAuthorizationUrl(result.authorizationUrl, production)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Single sign-on is not available.",
          },
        },
        { status: 401 },
      );
    }

    const maxAge = Math.min(
      Math.max(Number(result.expiresIn) || 0, 60),
      SSO_COOKIE_MAX_AGE,
    );
    const cookieOptions = {
      httpOnly: true,
      secure: production,
      // Lax: the IdP's redirect back to /api/auth/sso/callback is a cross-site top-level navigation.
      sameSite: "lax" as const,
      path: SSO_COOKIE_PATH,
      maxAge,
    };
    const response = NextResponse.json({
      success: true,
      data: { authorizationUrl: result.authorizationUrl },
    });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(
      SSO_BINDING_COOKIE,
      result.bindingToken,
      cookieOptions,
    );
    response.cookies.set(SSO_DEVICE_COOKIE, deviceId, cookieOptions);
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Single sign-on could not be started.",
        },
      },
      { status: 500 },
    );
  }
}

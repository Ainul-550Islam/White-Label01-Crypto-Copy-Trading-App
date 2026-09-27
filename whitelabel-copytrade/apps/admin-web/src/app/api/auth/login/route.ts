import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface SessionPayload {
  tokens: TokenPair;
  user: { id: string; email: string; isPlatformUser: boolean; permissions: string[] };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

type LoginResult = SessionPayload | ChallengePayload;

/**
 * Exchanges credentials for a session cookie.
 *
 * The token pair is written straight into httpOnly cookies and never returned
 * to the browser. The response body only says what should happen next.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'A JSON body is required.' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  // A stable per-browser device id lets the API bind refresh tokens to this
  // console instance and show it in the user's session list.
  const deviceId = `web-${randomUUID()}`;

  try {
    const result = await serverFetch<LoginResult>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        deviceId,
        deviceName: 'Admin console',
        platform: 'web',
      },
    });

    if ('twoFactorRequired' in result) {
      // The challenge token is short-lived and useless without the OTP, but it
      // still goes into an httpOnly cookie rather than the response body.
      const response = NextResponse.json({
        success: true,
        data: { twoFactorRequired: true, methods: result.methods },
      });

      response.cookies.set('wlct_2fa', result.challengeToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });
      response.cookies.set('wlct_2fa_did', deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });

      return response;
    }

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({
      success: true,
      data: { twoFactorRequired: false, redirectTo: '/dashboard' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: { code: error.code, message: error.message, details: error.details },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Sign-in failed. Please try again.' },
      },
      { status: 500 },
    );
  }
}

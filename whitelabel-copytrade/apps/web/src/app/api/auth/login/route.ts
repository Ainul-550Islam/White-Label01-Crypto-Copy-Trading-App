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
  user: { id: string; email: string };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

type LoginResult = SessionPayload | ChallengePayload;

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'A JSON body is required.' } },
      { status: 400 }
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
          details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
        },
      },
      { status: 400 }
    );
  }

  const deviceId = `web-${randomUUID()}`;
  const host = request.headers.get('host') ?? undefined;

  try {
    const result = await serverFetch<LoginResult>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        deviceId,
        deviceName: 'Customer Web',
        platform: 'web',
      },
      host,
    });

    if ('twoFactorRequired' in result) {
      const response = NextResponse.json({
        success: true,
        data: { requiresMfa: true, mfaToken: result.challengeToken, methods: result.methods },
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
      data: { requiresMfa: false, redirectTo: '/dashboard' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Sign-in failed. Please try again.' } },
      { status: 500 }
    );
  }
}

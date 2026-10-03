import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';
import { ApiError } from '@/lib/api-error';
import { buildVerifyBody, twoFactorRequestSchema } from '@/lib/two-factor-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Second step of sign-in. The challenge token and device id were stored as
 * httpOnly cookies by /api/auth/login and never reach browser JavaScript.
 * The backend body is built by buildVerifyBody (lib/two-factor-verify).
 */
interface VerifiedSession {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
}

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  const challengeToken = cookieStore.get('wlct_2fa')?.value;
  const deviceId = cookieStore.get('wlct_2fa_did')?.value;

  if (!challengeToken || !deviceId) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'MFA challenge expired. Please sign in again.' } },
      { status: 401 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'JSON body required.' } },
      { status: 400 }
    );
  }

  const parsed = twoFactorRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid code.' } },
      { status: 400 }
    );
  }

  try {
    const result = await serverFetch<VerifiedSession>('/auth/two-factor/verify', {
      method: 'POST',
      authenticated: false,
      body: buildVerifyBody(challengeToken, deviceId, parsed.data),
      host: request.headers.get('host') ?? undefined,
    });

    persistSession(result.tokens, deviceId, randomUUID());

    const response = NextResponse.json({ success: true, data: { redirectTo: '/dashboard' } });
    response.cookies.delete('wlct_2fa');
    response.cookies.delete('wlct_2fa_did');
    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'MFA verification failed.' } },
      { status: 500 }
    );
  }
}

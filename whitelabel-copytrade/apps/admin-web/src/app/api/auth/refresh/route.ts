import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { ApiError } from '@wlct/utils/api-error';
import { serverFetch } from '@/lib/server-api';
import { clearSession, getCsrfToken, getDeviceId, getRefreshToken, persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionPayload {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
}

/**
 * Rotates the session.
 *
 * The API revokes the whole token family if a consumed refresh token is
 * replayed, so a failure here means the session is gone: clear the cookies
 * rather than leaving a half-dead session in the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const submitted = request.headers.get('x-csrf-token');
  const expected = await getCsrfToken();

  if (!expected || submitted !== expected) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  const refreshToken = await getRefreshToken();
  const deviceId = await getDeviceId();

  if (!refreshToken || !deviceId) {
    await clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 },
    );
  }

  try {
    const result = await serverFetch<SessionPayload>('/auth/refresh', {
      method: 'POST',
      authenticated: false,
      body: { refreshToken, deviceId },
    });

    await persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({ success: true, data: { refreshed: true } });
  } catch (error) {
    await clearSession();

    const status = error instanceof ApiError ? error.status : 401;

    return NextResponse.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Your session has expired. Please sign in again.' },
      },
      { status: status === 401 || status === 403 ? 401 : status },
    );
  }
}

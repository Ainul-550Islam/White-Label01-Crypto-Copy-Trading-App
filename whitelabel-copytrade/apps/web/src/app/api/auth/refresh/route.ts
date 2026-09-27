import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverFetch } from '@/lib/server-api';
import { getRefreshToken, getDeviceId, persistSession, clearSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RefreshResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
  };
}

export async function POST(): Promise<NextResponse> {
  const refreshToken = getRefreshToken();
  const deviceId = getDeviceId();

  if (!refreshToken || !deviceId) {
    clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token.' } },
      { status: 401 }
    );
  }

  try {
    const result = await serverFetch<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      authenticated: false,
      body: { refreshToken, deviceId },
    });

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({ success: true, data: {} });
  } catch {
    clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Session refresh failed.' } },
      { status: 401 }
    );
  }
}

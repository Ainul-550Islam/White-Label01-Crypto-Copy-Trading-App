import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().min(6).max(32),
  method: z.enum(['TOTP', 'RECOVERY_CODE']).default('TOTP'),
});

interface SessionPayload {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
  sessionId: string;
}

/** Completes a two-factor challenge started by /api/auth/login. */
export async function POST(request: Request): Promise<NextResponse> {
  const store = cookies();
  const challengeToken = store.get('wlct_2fa')?.value;
  const deviceId = store.get('wlct_2fa_did')?.value;

  if (!challengeToken || !deviceId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'The challenge expired. Please sign in again.' },
      },
      { status: 401 },
    );
  }

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
        error: { code: 'VALIDATION_ERROR', message: 'Enter the six-digit code from your app.' },
      },
      { status: 400 },
    );
  }

  try {
    const result = await serverFetch<SessionPayload>('/auth/two-factor/verify', {
      method: 'POST',
      authenticated: false,
      body: {
        challengeToken,
        code: parsed.data.code,
        method: parsed.data.method,
        deviceId,
      },
    });

    persistSession(result.tokens, deviceId, randomUUID());

    const response = NextResponse.json({ success: true, data: { redirectTo: '/dashboard' } });
    response.cookies.delete('wlct_2fa');
    response.cookies.delete('wlct_2fa_did');
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
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Verification failed.' },
      },
      { status: 500 },
    );
  }
}

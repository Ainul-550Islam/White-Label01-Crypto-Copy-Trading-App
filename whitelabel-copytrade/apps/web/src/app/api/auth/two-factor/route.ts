import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';
import { ApiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().min(1).max(32),
  method: z.enum(['TOTP', 'RECOVERY']).default('TOTP'),
});

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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid code.' } },
      { status: 400 }
    );
  }

  try {
    const result = await serverFetch<{
      tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
    }>('/auth/two-factor/challenge', {
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
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'MFA verification failed.' } },
      { status: 500 }
    );
  }
}

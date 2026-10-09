import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@wlct/utils/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  firstName: z.string().trim().max(64).optional(),
  lastName: z.string().trim().max(64).optional(),
  locale: z.enum(['en', 'es', 'ar', 'bn', 'tr']).optional(),
  referralCode: z.string().trim().max(32).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms of service.' }),
  }),
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

  const deviceId = `web-${randomUUID()}`;
  const host = request.headers.get('host') ?? undefined;

  try {
    const result = await serverFetch<SessionPayload>('/auth/register', {
      method: 'POST',
      authenticated: false,
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
        ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
        ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
        ...(parsed.data.referralCode ? { referralCode: parsed.data.referralCode } : {}),
        acceptedTerms: true,
        deviceId,
        deviceName: 'Customer Web',
        platform: 'web',
      },
      host,
    });

    await persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json(
      {
        success: true,
        data: { redirectTo: '/onboarding' },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Registration failed. Please try again.' },
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import { serverFetch } from '@/lib/server-api';
import { clearSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    await serverFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors, clear cookies anyway
  } finally {
    clearSession();
  }

  const response = NextResponse.json({ success: true, data: { redirectTo: '/login' } });
  response.cookies.delete('wlct_2fa');
  response.cookies.delete('wlct_2fa_did');
  return response;
}

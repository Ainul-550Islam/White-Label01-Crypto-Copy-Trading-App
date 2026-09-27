import { NextResponse } from 'next/server';

import { serverFetch } from '@/lib/server-api';
import { clearSession, getAccessToken, getCsrfToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends the session.
 *
 * Cookies are cleared regardless of what the API says: a user who clicks sign
 * out must end up signed out locally even if the backend call fails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const submitted = request.headers.get('x-csrf-token');
  const expected = getCsrfToken();

  if (!expected || submitted !== expected) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
      { status: 403 },
    );
  }

  if (getAccessToken()) {
    try {
      await serverFetch('/auth/logout', { method: 'POST', body: { allDevices: false } });
    } catch {
      // Intentionally swallowed: local sign-out must still happen.
    }
  }

  clearSession();

  return NextResponse.json({ success: true, data: { loggedOut: true } });
}

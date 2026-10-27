import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@wlct/utils/api-error';
import { serverFetch } from '@/lib/server-api';

const token = z.string().regex(/^[A-Za-z0-9_-]{40,128}$/);
const inputs = {
  request: z.object({ email: z.string().email().max(254) }).strict(),
  verify: z.object({ token }).strict(),
  complete: z.object({ token, newPassword: z.string().min(12).max(128) }).strict(),
};
const outputs = {
  request: z.object({ accepted: z.literal(true) }).passthrough(),
  verify: z.object({ valid: z.boolean(), reason: z.string().nullable() }).passthrough(),
  complete: z.object({ status: z.enum(['RECOVERED', 'REFUSED']), reason: z.string().nullable(), sessionsRevoked: z.number().int().nonnegative(), requiresTwoFactorEnrolment: z.literal(false) }).passthrough(),
};
type Operation = keyof typeof inputs;
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

function answer(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}

/** Three fixed public operations, deliberately separate from the generic proxy. */
export async function recoveryBff(request: NextRequest, operation: Operation) {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  try {
    const parsed = new URL(origin ?? '');
    if (!host || parsed.host.toLowerCase() !== host.toLowerCase() || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return answer({ message: 'Request origin is not permitted.' }, 403);
    }
  } catch { return answer({ message: 'Request origin is not permitted.' }, 403); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return answer({ message: 'Invalid request.' }, 415);
  const key = request.headers.get('idempotency-key') ?? undefined;
  if (operation !== 'verify' && (!key || !keyPattern.test(key))) return answer({ message: 'Invalid request.' }, 400);
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > 4096) return answer({ message: 'Invalid request.' }, 413);
  let raw: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return answer({ message: 'Invalid request.' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return answer({ message: 'Invalid request.' }, 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return answer({ message: 'Invalid request.' }, 400); }
  const input = inputs[operation].safeParse(raw);
  if (!input.success) return answer({ message: 'Check the information and try again.' }, 400);
  try {
    const result = await serverFetch<unknown>(`/auth/recovery/${operation}`, {
      method: 'POST', body: input.data, authenticated: false, host, idempotencyKey: key,
      signal: AbortSignal.timeout(12_000),
    });
    const output = outputs[operation].safeParse(result);
    if (!output.success) return answer({ message: 'Account recovery is temporarily unavailable.' }, 503);
    if (operation === 'request') return answer({ accepted: true, message: 'If an eligible account matches, recovery instructions may be sent.' }, 202);
    if (operation === 'verify') {
      const valid = (output.data as z.infer<typeof outputs.verify>).valid;
      return answer({ valid, reason: valid ? null : 'INVALID_TOKEN', message: valid ? 'Recovery link confirmed.' : 'This recovery link is invalid, expired or already used.' }, 200);
    }
    const complete = output.data as z.infer<typeof outputs.complete>;
    return answer({ status: complete.status, sessionsRevoked: complete.sessionsRevoked, requiresTwoFactorEnrolment: false,
      reason: complete.status === 'RECOVERED' ? null : 'INVALID_TOKEN',
      message: complete.status === 'RECOVERED' ? 'Your password was changed and your existing sessions were signed out.' : 'This recovery link is invalid, expired or already used.' }, 200);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    if (status === 429) return answer({ message: 'Too many requests. Please try again later.' }, 429);
    if (status === 409) return answer({ message: 'This retry key was used for a different request.' }, 409);
    if (status === 400 || status === 422) return answer({ message: 'The information does not meet the account security requirements.' }, 400);
    return answer({ message: 'Account recovery is temporarily unavailable.' }, 503);
  }
}

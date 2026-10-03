import { hasAnyPermission } from '@wlct/shared-types';
import { Session } from './auth.types';

/**
 * UX-only permission checks for showing or hiding screens and actions. The
 * backend enforces every permission itself; this only avoids offering the
 * user something that would answer 403.
 *
 * Uses the backend's own matcher from @wlct/shared-types, so `*` (super
 * administrators) and `resource:*` wildcards behave exactly as on the API.
 */
export function sessionHasAnyPermission(session: Session | null | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return hasAnyPermission(session?.user.permissions ?? [], required);
}

export function permissionsAllowAny(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return hasAnyPermission(granted, required);
}

/**
 * Frontend-safe auth/session/user types.
 * Never contains secrets, private keys, or raw tokens.
 */

export interface User {
  id: string;
  email: string;
  tenantId: string;
  roles: string[];
  displayName?: string;
  avatarUrl?: string;
  mfaEnabled?: boolean;
}

export interface Session {
  user: User;
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  entitlements: Record<string, boolean>;
  expiresAt?: string;
  isAuthenticated: boolean;
}

export interface AuthState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

export interface LoginFormData {
  email: string;
  password: string;
}

export interface MfaFormData {
  code: string;
  method: 'TOTP' | 'RECOVERY';
}

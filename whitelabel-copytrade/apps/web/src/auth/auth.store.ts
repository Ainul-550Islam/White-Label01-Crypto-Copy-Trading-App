'use client';

import { createContext, useContext } from 'react';
import { Session } from './auth.types';

/**
 * Session/auth state using secure storage conventions and backend-authoritative session state.
 * Frontend never stores JWT, refresh token, private keys, or secrets.
 * Session is httpOnly cookie based, managed by backend.
 */

export interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  refreshSession: async () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function clearSensitiveSessionState(): void {
  // Clear only non-sensitive UX state from localStorage
  // Never clear httpOnly cookies from JS (managed by backend)
  try {
    const safeKeys = ['theme', 'layout_prefs', 'table_prefs'];
    const allKeys = Object.keys(localStorage);
    for (const key of allKeys) {
      if (!safeKeys.some((safe) => key.startsWith(safe))) {
        // Only clear keys that are known to be sensitive if they exist
        if (key.includes('token') || key.includes('secret') || key.includes('private') || key.includes('credential')) {
          localStorage.removeItem(key);
        }
      }
    }
    sessionStorage.clear();
  } catch {
    // Ignore storage errors
  }
}

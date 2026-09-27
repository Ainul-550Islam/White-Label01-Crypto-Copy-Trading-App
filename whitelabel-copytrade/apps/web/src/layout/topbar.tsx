'use client';

import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';
import { useState } from 'react';
import Link from 'next/link';

export function Topbar(): JSX.Element {
  const { session, logout } = useAuth();
  const { tenant } = useTenant();
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <TenantLogo className="h-8 w-8 rounded" fallback={<div className="h-8 w-8 rounded bg-primary" />} />
        <span className="hidden font-semibold md:inline">{tenant?.branding?.appName ?? tenant?.name ?? 'App'}</span>
      </div>

      <div className="flex items-center gap-4">
        <Link href="/notifications" className="relative rounded p-2 hover:bg-accent" aria-label="Notifications">
          🔔
        </Link>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full p-1 hover:bg-accent"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            <div className="h-8 w-8 rounded-full bg-primary text-center text-sm leading-8 text-white">
              {session?.user.email?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <span className="hidden text-sm md:inline">{session?.user.email}</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-md border bg-card shadow-lg">
              <div className="p-2">
                <p className="truncate text-sm font-medium">{session?.user.email}</p>
                <p className="truncate text-xs text-muted">{tenant?.name}</p>
              </div>
              <div className="border-t">
                <Link href="/account" className="block px-4 py-2 text-sm hover:bg-accent">
                  Account Settings
                </Link>
                <Link href="/security" className="block px-4 py-2 text-sm hover:bg-accent">
                  Security
                </Link>
                <Link href="/billing" className="block px-4 py-2 text-sm hover:bg-accent">
                  Billing
                </Link>
                <button
                  onClick={() => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

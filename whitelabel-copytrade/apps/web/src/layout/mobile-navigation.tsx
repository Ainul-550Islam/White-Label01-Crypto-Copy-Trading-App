'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/tenant/tenant-context';

const mobileNav = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'Portfolio', href: '/portfolio', icon: '💼' },
  { label: 'Traders', href: '/traders', icon: '👥' },
  { label: 'Funding', href: '/funding', icon: '💰' },
  { label: 'Account', href: '/account', icon: '👤' },
];

export function MobileNavigation(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const pathname = usePathname();
  const { tenant } = useTenant();

  return (
    <div className="border-b bg-card md:hidden">
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{tenant?.name ?? 'Menu'}</span>
        <button
          onClick={() => setOpen(!open)}
          className="rounded p-2 hover:bg-accent"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? '✕' : '☰'}
        </button>
      </div>
      {open && (
        <nav className="border-t p-4">
          <ul className="space-y-1">
            {mobileNav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                      isActive ? 'bg-primary text-white' : 'hover:bg-accent'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

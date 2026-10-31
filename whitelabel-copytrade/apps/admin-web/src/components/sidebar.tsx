'use client';
// # Responsibility: renders the console navigation the shell hands it — no table, no permission rule of its own, so what a user may see is decided in one place by the layout.
import type { JSX } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavItem } from '@/app/(console)/layout';
import { theme } from '@/lib/theme';

/**
 * Renders the entries it is given.
 *
 * The table and the permission/platform rule live in the console layout, which
 * decodes the claims and passes only the entries they may see. This component
 * deliberately holds no filtering of its own: two copies of a visibility rule
 * are two places for them to disagree.
 */
export function Sidebar({ items }: { items: readonly NavItem[] }): JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: theme.space(3),
      }}
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'block',
              padding: '9px 12px',
              borderRadius: theme.radius.sm,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? theme.color.text : theme.color.textMuted,
              background: active ? theme.color.surfaceRaised : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

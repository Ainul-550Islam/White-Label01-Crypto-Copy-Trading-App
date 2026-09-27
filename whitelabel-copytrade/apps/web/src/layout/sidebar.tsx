'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/tenant/tenant-context';
import { useAuth } from '@/auth/auth.store';
import { featureCatalog } from '@/config/feature-config';

const navGroups = [
  {
    label: 'Main',
    items: [
      { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: '📊' },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', icon: '💼' },
      { key: 'traders', label: 'Traders', href: '/traders', icon: '👥' },
      { key: 'strategies', label: 'Strategies', href: '/strategies', icon: '📈' },
      { key: 'copy_trading', label: 'Copy Trading', href: '/copy-trading', icon: '🔄' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { key: 'exchanges', label: 'Exchanges', href: '/exchanges', icon: '🏦' },
      { key: 'funding', label: 'Funding', href: '/funding', icon: '💰' },
      { key: 'billing', label: 'Billing', href: '/billing', icon: '💳' },
      { key: 'statements', label: 'Statements', href: '/statements', icon: '📄' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'security', label: 'Security', href: '/security', icon: '🔒' },
      { key: 'notifications', label: 'Notifications', href: '/notifications', icon: '🔔' },
      { key: 'account', label: 'Account', href: '/account', icon: '👤' },
    ],
  },
];

export function Sidebar(): JSX.Element {
  const pathname = usePathname();
  const { tenant } = useTenant();
  const { session } = useAuth();

  const entitlements = tenant?.entitlements ?? {};
  const roles = session?.user.roles ?? [];

  return (
    <nav className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 py-2">
        <h2 className="text-sm font-semibold">{tenant?.name ?? 'Loading...'}</h2>
        {tenant?.plan && <p className="text-xs text-muted">{tenant.plan.name}</p>}
      </div>

      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <h3 className="px-2 text-xs font-medium uppercase text-muted">{group.label}</h3>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const feature = featureCatalog.find((f) => f.key === item.key);
              if (feature?.requiresEntitlement && !entitlements[feature.requiresEntitlement]) {
                return null; // UX-only hiding, backend remains authoritative
              }
              if (feature?.requiresRole && feature.requiresRole.length > 0) {
                const hasRole = feature.requiresRole.some((r) => roles.includes(r));
                if (!hasRole) return null;
              }

              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                      isActive ? 'bg-primary text-white' : 'hover:bg-accent'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto border-t pt-4">
        <p className="px-2 text-xs text-muted">© {new Date().getFullYear()} {tenant?.name ?? 'Platform'}</p>
      </div>
    </nav>
  );
}

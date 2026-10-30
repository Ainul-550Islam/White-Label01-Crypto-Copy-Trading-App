'use client';
import type { JSX } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { theme } from '@/lib/theme';

export interface NavItem {
  href: string;
  label: string;
  /** Permission required to see the entry. Empty means always visible. */
  permission?: string;
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/tenants', label: 'Organisations', permission: 'tenant:read', platformOnly: true },
  { href: '/users', label: 'Users', permission: 'user:read' },
  { href: '/roles', label: 'Roles & permissions', permission: 'role:read' },
  { href: '/strategies', label: 'Strategies', permission: 'strategy_instance:read' },
  // Read-only metadata over historical data (Part 7). Visibility is a
  // usability filter, not the access control - the API enforces
  // dataset:read on every route this page consumes.
  { href: '/datasets', label: 'Datasets', permission: 'dataset:read' },
  // Custody oversight: wallets, treasury balances, reserves, sweeps,
  // transactions and reconciliation. Read visibility follows the permission the
  // API requires on the read routes (payout management covers every one of
  // them); running or resolving reconciliation additionally needs
  // reconciliation:trigger / reconciliation:resolve, which the pages check.
  { href: '/custody', label: 'Custody', permission: 'payout:manage' },
  { href: '/custody/transactions', label: 'Custody transactions', permission: 'payout:manage' },
  { href: '/custody/withdrawals', label: 'Custody withdrawals', permission: 'payout:manage' },
  { href: '/custody/destinations', label: 'Withdrawal destinations', permission: 'payout:manage' },
  { href: '/custody/reconciliation', label: 'Custody reconciliation', permission: 'payout:manage' },
  // Order management: the OMS console over intents, fills, trades,
  // reconciliation, rejections, allocations and the audit trail. The API
  // requires trading:manage on the class and trading:read or compliance:read
  // on the reads; the recovery console is trading:manage only, because it
  // moves an order to a terminal state behind a single-use verification.
  { href: '/oms', label: 'Orders', permission: 'trading:read' },
  { href: '/oms/reconciliation', label: 'Order reconciliation', permission: 'trading:read' },
  { href: '/oms/operations', label: 'Order exceptions', permission: 'trading:read' },
  { href: '/oms/rejections', label: 'Order rejections', permission: 'trading:read' },
  { href: '/oms/allocations', label: 'Allocations', permission: 'trading:read' },
  { href: '/oms/audit', label: 'Order audit trail', permission: 'trading:read' },
  { href: '/oms/recovery', label: 'Order recovery', permission: 'trading:manage' },
  // Part 8: mirrored risk posture plus the stop/clear ceremony. The
  // permission gates the link; the API gates every call the page makes.
  { href: '/risk', label: 'Risk', permission: 'risk:read' },
  // Risk detail screens over the risk-management surface: policy versions,
  // breaker and kill-switch lifecycle, liquidation alerts, and the caller's own
  // position limits. Every write behind these pages is step-up protected or
  // needs the typed phrase its DTO enforces.
  { href: '/risk/policies', label: 'Risk policy', permission: 'risk:read' },
  { href: '/risk/controls', label: 'Risk controls', permission: 'risk:read' },
  { href: '/risk/alerts', label: 'Liquidation alerts', permission: 'risk:read' },
  { href: '/risk/overview', label: 'Risk overview', permission: 'risk:read' },
  { href: '/risk/liquidation-alerts', label: 'Liquidation alerts (risk)', permission: 'risk:read' },
  { href: '/risk/position-limits', label: 'Position limits', permission: 'risk:read' },
  { href: '/risk/limits', label: 'My position limits', permission: 'risk:read' },
  { href: '/observability', label: 'Observability', permission: 'operations:read' },
  // Part 10: error budgets, burn paging, telemetry posture. Read-mostly:
  // its two writes append definition VERSIONS and ask the evaluator to look.
  { href: '/slo', label: 'Service objectives', permission: 'operations:read' },
  { href: '/branding', label: 'Branding', permission: 'tenant:read' },
  // Round 7: these two entries used 'billing:read' and 'audit:read', which
  // are not permissions (packages/shared-types rbac.ts), so the links were
  // hidden from everyone except '*' holders. They now name the permissions
  // the API actually enforces on the routes the pages call.
  { href: '/subscription', label: 'Subscription', permission: 'subscription:read' },
  // Round 7: the self-service billing portal (plans, checkout, invoices,
  // usage) and the plan catalogue. Both were built but never mounted.
  { href: '/billing', label: 'Billing', permission: 'subscription:read' },
  { href: '/plans', label: 'Plan catalogue', permission: 'plan:read' },
  // Platform-wide SaaS tenant administration (plan, branding, domains,
  // entitlements per tenant). The API requires platform:manage on every call.
  { href: '/saas-admin', label: 'SaaS tenants', permission: 'platform:manage', platformOnly: true },
  { href: '/audit-logs', label: 'Audit log', permission: 'audit_log:read' },
  { href: '/developer', label: 'Developer', permission: 'api_key:read' },
  // Venue status overrides are platform-only (the API requires
  // platform:manage); stream health is an execution read.
  { href: '/exchanges', label: 'Venue status', permission: 'platform:manage', platformOnly: true },
  { href: '/exchanges/user-streams', label: 'User data streams', permission: 'execution:read' },
  { href: '/exchanges/venues', label: 'Venues and streams', permission: 'execution:read' },
  { href: '/exchanges/operations', label: 'Exchange operations', permission: 'exchange_account:read' },
  // Execution orders and the exchange accounts they draw on. Enabling live
  // trading from the account screen needs a typed confirmation phrase.
  { href: '/execution/orders', label: 'Execution orders', permission: 'order:read' },
  { href: '/execution-orders', label: 'Execution orders and accounts', permission: 'order:read' },
  { href: '/execution/accounts', label: 'Exchange accounts', permission: 'exchange_account:read' },
  { href: '/execution/reconciliation', label: 'Execution reconciliation', permission: 'reconciliation:read' },
  // Revenue analytics and notification delivery. Both are read-heavy; the
  // notification screen rotates webhook secrets, which the API returns once.
  { href: '/analytics/billing', label: 'Billing analytics', permission: 'subscription:read' },
  { href: '/billing/analytics', label: 'Billing analytics (period)', permission: 'subscription:read' },
  { href: '/billing/analytics/reports', label: 'Financial reports', permission: 'subscription:read' },
  { href: '/billing/notifications', label: 'Billing notifications', permission: 'tenant:update' },
  { href: '/billing/inbox', label: 'Billing inbox', permission: 'subscription:read' },
  // Copy-trading operations and the accounting ledger. The strategy lifecycle
  // and the ledger writes are the two places where a wrong click moves money,
  // so both pages name the state they are about to change.
  { href: '/copy-trading', label: 'Copy trading', permission: 'strategy:read' },
  { href: '/copy-trading/reconciliation', label: 'Copy reconciliation', permission: 'reconciliation:read' },
  { href: '/accounting', label: 'Portfolio accounting', permission: 'payout:manage' },
  { href: '/settings', label: 'Settings', permission: 'tenant:read' },
];

/**
 * Navigation is filtered by the permissions embedded in the session.
 *
 * This is a usability filter only - hiding a link is not access control. Every
 * route also re-checks authorisation server-side, and the API is the final
 * authority on every request.
 */
export function Sidebar({
  permissions,
  isPlatformUser,
}: {
  permissions: string[];
  isPlatformUser: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.platformOnly && !isPlatformUser) {
      return false;
    }
    if (!item.permission) {
      return true;
    }
    if (permissionSet.has('*')) {
      return true;
    }

    const [resource] = item.permission.split(':');
    return permissionSet.has(item.permission) || permissionSet.has(`${resource}:*`);
  });

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
      {visible.map((item) => {
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

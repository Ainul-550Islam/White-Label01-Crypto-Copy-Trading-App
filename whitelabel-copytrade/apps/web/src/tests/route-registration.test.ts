// # Responsibility: proves every page this batch adds exists, is registered in the route map, is reachable from the navigation, and is not an orphan file nothing points at.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(process.cwd(), 'src');
const read = (relative: string): string => readFileSync(resolve(src, relative), 'utf8');

/** Every page this batch adds: the route path, and the file that renders it. */
const PAGES: ReadonlyArray<{ route: string; file: string; routeKey: string }> = [
  { route: '/copy-trading/rebalance', file: 'app/copy-trading/rebalance/page.tsx', routeKey: 'copyRebalance' },
  { route: '/copy-trading/budget', file: 'app/copy-trading/budget/page.tsx', routeKey: 'copyBudget' },
  { route: '/copy-trading/timeline', file: 'app/copy-trading/timeline/page.tsx', routeKey: 'copyTimeline' },
  { route: '/copy-trading/benchmark', file: 'app/copy-trading/benchmark/page.tsx', routeKey: 'copyBenchmark' },
  { route: '/copy-trading/fees', file: 'app/copy-trading/fees/page.tsx', routeKey: 'copyFees' },
  { route: '/portfolio/accounting', file: 'app/portfolio/accounting/page.tsx', routeKey: 'accounting' },
  { route: '/exchanges/stream-status', file: 'app/exchanges/stream-status/page.tsx', routeKey: 'streamStatus' },
  { route: '/funding/destinations', file: 'app/funding/destinations/page.tsx', routeKey: 'destinations' },
  { route: '/notifications/inbox', file: 'app/notifications/inbox/page.tsx', routeKey: 'notificationInbox' },
  { route: '/notifications/preferences/events', file: 'app/notifications/preferences/events/page.tsx', routeKey: 'notificationEventPrefs' },
];

const routesSource = read('app/routes.tsx');
const sidebarSource = read('layout/sidebar.tsx');

describe('every new page', () => {
  it.each(PAGES)('$route exists and exports a page', ({ file }) => {
    const absolute = resolve(src, file);

    expect(existsSync(absolute)).toBe(true);
    const source = readFileSync(absolute, 'utf8');
    expect(source).toContain('export default function Page(): JSX.Element');
    expect(source).toContain('<AuthGuard>');
    expect(source).toContain('<AppShell>');
  });

  it.each(PAGES)('$route is registered in the route map under $routeKey', ({ route, routeKey }) => {
    expect(routesSource).toContain(`${routeKey}: '${route}'`);
  });

  it.each(PAGES)('$route is reachable from the navigation', ({ route }) => {
    expect(sidebarSource).toContain(`href: '${route}'`);
  });
});

describe('no orphan pages', () => {
  it('has no page directory that the route map and the navigation both ignore', () => {
    // The pages this batch adds are the ones under these prefixes; each must be registered.
    const owned = /app\/(copy-trading\/(rebalance|budget|timeline|benchmark|fees)|portfolio\/accounting|exchanges\/stream-status|funding\/destinations|notifications\/inbox|notifications\/preferences\/events)$/;
    const orphans = PAGES.map((page) => page.file.replace(/\/page\.tsx$/, '')).filter((directory) => !owned.test(directory));

    expect(orphans).toEqual([]);
  });

  it('keeps the protected route list derived, so a new page cannot be unprotected by accident', () => {
    expect(routesSource).toContain('export const protectedRoutes');
    expect(routesSource).toContain("typeof v === 'string' ? [v] : []");
  });
});

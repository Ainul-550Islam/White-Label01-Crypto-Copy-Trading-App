// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Verifies canonical marketplace metadata and default-deny crawler policies without relying on deployment secrets.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('public marketplace SEO controls', () => {
  it('defines distinct canonical metadata for trader and strategy routes', () => {
    const traders = readFileSync(resolve(process.cwd(), 'src/app/traders/layout.tsx'), 'utf8');
    const strategies = readFileSync(resolve(process.cwd(), 'src/app/strategies/layout.tsx'), 'utf8');
    expect(traders).toContain("title: 'Copy-trading marketplace'");
    expect(traders).toContain("publicUrlFor('/traders')");
    expect(strategies).toContain("title: 'Trading strategies'");
    expect(strategies).toContain("publicUrlFor('/strategies')");
    expect(traders).toContain('robots: { index: true, follow: true }');
    expect(strategies).toContain('robots: { index: true, follow: true }');
  });

  it('keeps sitemap allowlisted and robots default-deny for private/share routes', () => {
    const sitemap = readFileSync(resolve(process.cwd(), 'src/app/sitemap.ts'), 'utf8');
    const robots = readFileSync(resolve(process.cwd(), 'src/app/robots.ts'), 'utf8');
    const publicOrigin = readFileSync(resolve(process.cwd(), 'src/lib/public-origin.ts'), 'utf8');
    expect(sitemap).toContain('PUBLIC_ROUTES');
    expect(robots).toContain('PRIVATE_ROUTE_PREFIXES');
    expect(publicOrigin).toContain("'/s'");
    expect(publicOrigin).toContain("'/recovery'");
    expect(publicOrigin).toContain("'/billing'");
    expect(robots).toContain("disallow: '/'");
  });
});

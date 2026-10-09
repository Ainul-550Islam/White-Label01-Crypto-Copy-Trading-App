// # Verifies the crawler policy: default-deny robots, public-only sitemap, fail-closed origin
//
// The policy is only worth having if a private route cannot become crawlable by accident, so the
// assertions are about refusal rather than about the happy path: an unnamed host must resolve to
// no origin at all, every authenticated surface must be denied, and the deny list must keep its
// catch-all. A change that dropped `disallow: '/'` would leave `robots.txt` looking reasonable
// while exposing the whole application, which is the failure this file exists to catch.
//
// `resolveOrigin` is pure, so every host shape is exercised directly rather than through whatever
// `NEXT_PUBLIC_*` the machine running the tests happens to have set. The reserved route modules
// read the environment once at import, so their assertions branch on the origin they resolved and
// cover both outcomes instead of assuming one.
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import {
  PRIVATE_ROUTE_PREFIXES,
  PUBLIC_ROUTES,
  publicUrlFor,
  resolveOrigin,
  resolvePublicOrigin,
} from '../lib/public-origin';

type RobotsRule = { userAgent: string; allow?: string[]; disallow?: string[] };
type RobotsResult = { rules: RobotsRule | RobotsRule[]; sitemap?: string; host?: string };

function firstRule(result: RobotsResult): RobotsRule {
  return Array.isArray(result.rules) ? (result.rules[0] as RobotsRule) : result.rules;
}

describe('crawler policy: origin resolution', () => {
  it('names a host for an explicitly configured public origin', () => {
    expect(resolveOrigin('https://app.example.com', 'localhost')).toBe('https://app.example.com');
    expect(resolveOrigin('https://app.example.com', '')).toBe('https://app.example.com');
  });

  it('falls back to the platform domain when no site URL is configured', () => {
    expect(resolveOrigin('', 'app.example.com')).toBe('https://app.example.com');
    expect(resolveOrigin('   ', 'app.example.com')).toBe('https://app.example.com');
  });

  it('refuses a host that names a machine rather than a deployment', () => {
    expect(resolveOrigin('', 'localhost')).toBeNull();
    expect(resolveOrigin('http://localhost:3001', '')).toBeNull();
    expect(resolveOrigin('', '127.0.0.1')).toBeNull();
    expect(resolveOrigin('', '0.0.0.0')).toBeNull();
    expect(resolveOrigin('', '::1')).toBeNull();
    expect(resolveOrigin('', '10.0.0.5')).toBeNull();
    expect(resolveOrigin('', '')).toBeNull();
  });

  it('refuses a name reserved for local or invalid use', () => {
    expect(resolveOrigin('', 'app.local')).toBeNull();
    expect(resolveOrigin('', 'app.test')).toBeNull();
    expect(resolveOrigin('', 'app.invalid')).toBeNull();
    expect(resolveOrigin('', 'app.example')).toBeNull();
  });

  it('refuses to build an origin out of junk or a non-web scheme', () => {
    expect(resolveOrigin('not a url', 'app.example.com')).toBeNull();
    expect(resolveOrigin('javascript:alert(1)', 'app.example.com')).toBeNull();
    expect(resolveOrigin('ftp://app.example.com', 'app.example.com')).toBeNull();
    expect(resolveOrigin('https://', 'app.example.com')).toBeNull();
  });

  it('keeps the port an operator configured', () => {
    expect(resolveOrigin('https://app.example.com:8443', '')).toBe('https://app.example.com:8443');
  });

  it('never builds a public URL without an origin', () => {
    // The production path is the branch under test when the suite runs in an unnamed environment,
    // and the refusal is asserted directly so it holds in either case.
    if (resolvePublicOrigin() === null) {
      expect(publicUrlFor('/pricing')).toBeNull();
      expect(publicUrlFor('/')).toBeNull();
    } else {
      expect(publicUrlFor('/pricing')).toBe(`${resolvePublicOrigin()}/pricing`);
      expect(publicUrlFor('/')).toBe(`${resolvePublicOrigin()}/`);
    }
  });
});

describe('crawler policy: robots.txt', () => {
  it('denies everything when the deployment cannot name a public host', () => {
    const result = robots() as RobotsResult;
    const rule = firstRule(result);

    expect(rule.userAgent).toBe('*');
    // The catch-all is present in both branches: it is what makes the policy default-deny.
    expect(rule.disallow).toContain('/');

    if (resolvePublicOrigin() === null) {
      // No sitemap pointer and no host when there is no origin: a crawler is told nothing.
      expect(result.sitemap).toBeUndefined();
      expect(result.host).toBeUndefined();
      expect(rule.allow).toBeUndefined();
    } else {
      expect(rule.allow).toEqual([...PUBLIC_ROUTES]);
      expect(result.sitemap).toBe(`${resolvePublicOrigin()}/sitemap.xml`);
      expect(result.host).toBe(resolvePublicOrigin());
    }
  });

  it('never allowlists an authenticated surface', () => {
    // The allowlist is the only thing that makes a path crawlable, so it is checked directly
    // against the deny list: a route in both would be a policy that contradicts itself.
    for (const privatePath of PRIVATE_ROUTE_PREFIXES) {
      expect(PUBLIC_ROUTES).not.toContain(privatePath);
    }
    expect(PUBLIC_ROUTES).toContain('/traders');
    expect(PUBLIC_ROUTES).not.toContain('/dashboard');
    expect(PUBLIC_ROUTES).not.toContain('/copy-trading');
  });

  it('covers the authenticated application in the deny list', () => {
    for (const required of ['/dashboard', '/account', '/portfolio', '/copy-trading', '/api']) {
      expect(PRIVATE_ROUTE_PREFIXES).toContain(required);
    }
  });

  it('keeps the catch-all that makes the policy default-deny', () => {
    // This is the assertion that fails if someone "simplifies" robots.txt into an allowlist-only
    // policy, which would expose every route added after it.
    const rule = firstRule(robots() as RobotsResult);
    expect(rule.disallow).toContain('/');
  });
});

describe('crawler policy: sitemap', () => {
  it('advertises nothing when the deployment cannot name a public host', () => {
    if (resolvePublicOrigin() === null) {
      expect(sitemap()).toEqual([]);
    } else {
      expect(sitemap().map((entry) => entry.url)).toEqual(
        PUBLIC_ROUTES.map((route) => publicUrlFor(route)),
      );
    }
  });

  it('advertises only routes that robots.txt allows', () => {
    // A sitemap entry that robots.txt refuses is a contradiction crawlers report as an error.
    // Entries are built from PUBLIC_ROUTES, so this asserts the invariant at the list level.
    for (const route of PUBLIC_ROUTES) {
      expect(route.startsWith('/')).toBe(true);
      expect(PRIVATE_ROUTE_PREFIXES).not.toContain(route);
    }
  });

  it('never lists a dynamic or authenticated route', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).not.toMatch(/\[/);
      expect(route).not.toContain('?');
      expect(route).not.toContain('#');
    }
  });
});

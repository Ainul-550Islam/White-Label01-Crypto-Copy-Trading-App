// # NEW — Proves a shared trader/strategy page publishes only opted-in fields, stays out of search by default, and describes its numbers exactly as stored.
import {
  buildShareDescription,
  buildShareMetadata,
  formatSharePercent,
  orderedShareFields,
  toNextMetadata,
  unavailableShareMetadata,
  type ShareProjection,
} from '../features/trading/public-share-metadata';

function projection(overrides: Partial<ShareProjection> = {}): ShareProjection {
  return {
    subjectType: 'TRADER',
    fields: {},
    expiresAt: '2026-11-25T12:00:00.000Z',
    indexable: false,
    ...overrides,
  };
}

describe('public share metadata', () => {
  test('never mentions a number the owner did not share', () => {
    const description = buildShareDescription(
      projection({ fields: { displayName: 'Ada', headline: 'Momentum trader' } }),
    );

    expect(description).toContain('Momentum trader');
    expect(description).not.toContain('%');
    // A share with no numbers must not imply performance at all.
    expect(description.toLowerCase()).not.toContain('return');
  });

  test('describes shared numbers exactly as stored, without re-parsing them', () => {
    expect(formatSharePercent('12.40')).toBe('12.4%');
    expect(formatSharePercent('0.000000000001')).toBe('0.000000000001%');
    expect(formatSharePercent(null)).toBeNull();

    const description = buildShareDescription(
      projection({
        fields: { returnPercent30d: '12.40', maxDrawdownPercent: '6.10' },
      }),
    );
    expect(description).toContain('12.4% over the last 30 days');
    expect(description).toContain('6.1% maximum drawdown');
    expect(description).toContain('Past performance is not a reliable indicator of future results.');
  });

  test('is noindex unless the owner opted in', () => {
    const hidden = buildShareMetadata({ projection: projection(), origin: 'https://app.example.com', token: 'tok' });
    const listed = buildShareMetadata({
      projection: projection({ indexable: true }),
      origin: 'https://app.example.com',
      token: 'tok',
    });

    expect(hidden.robots).toBe('noindex, nofollow');
    expect(listed.robots).toBe('index, follow');
    // Anything other than an explicit true is treated as hidden.
    expect(
      buildShareMetadata({
        projection: projection({ indexable: undefined as unknown as boolean }),
        origin: 'https://app.example.com',
        token: 'tok',
      }).robots,
    ).toBe('noindex, nofollow');
  });

  test('points the share URL at itself, not at the private profile', () => {
    const meta = buildShareMetadata({
      projection: projection({ fields: { displayName: 'Ada' } }),
      origin: 'https://app.example.com/',
      token: 'abc.def',
    });

    expect(meta.canonicalUrl).toBe('https://app.example.com/s/abc.def');
    expect(meta.openGraph.url).toBe(meta.canonicalUrl);
    expect(meta.title).toContain('Ada');
  });

  test('an unavailable link is always noindex and never repeats the token', () => {
    const meta = unavailableShareMetadata('This link is not available.');
    const next = toNextMetadata(meta);

    expect(meta.robots).toBe('noindex, nofollow');
    expect(JSON.stringify(next)).not.toContain('/s/');
    expect(next.description).toBe('This link is not available.');
  });

  test('renders only shared fields, in reading order, and never balances or followers', () => {
    const fields = orderedShareFields(
      // The projection can only contain allow-listed keys, but the ordering helper is
      // the last place a stray key could reach the page, so it is tested with one.
      projection({
        fields: {
          displayName: 'Ada',
          followerCount: 812,
          returnPercent30d: '12.40',
          headline: 'Momentum',
        },
      }),
    );

    const orderedKeys = fields.map((entry) => entry.field);
    expect(orderedKeys).toEqual(['displayName', 'headline', 'returnPercent30d']);
    expect(JSON.stringify(fields)).not.toContain('812');
  });
});

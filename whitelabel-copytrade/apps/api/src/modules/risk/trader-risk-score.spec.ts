// # Responsibility: verifies deterministic scoring, explainability and fail-closed handling of missing/stale trader risk data.

import { TraderRiskFactorInput, TraderRiskScoreService } from './trader-risk-score.service';

const base: TraderRiskFactorInput[] = [
  { key: 'maxDrawdownPercent', value: '10', observedAt: '2025-01-01T00:00:00.000Z', source: 'verified-nav' },
  { key: 'leverage', value: '2', observedAt: '2025-01-01T00:00:00.000Z', source: 'venue-account' },
  { key: 'concentrationPercent', value: '20', observedAt: '2025-01-01T00:00:00.000Z', source: 'positions' },
  { key: 'lossStreak', value: '1', observedAt: '2025-01-01T00:00:00.000Z', source: 'closed-fills' },
];

describe('TraderRiskScoreService', () => {
  const service = new TraderRiskScoreService();

  it('returns a deterministic explainable score from measured factor observations', () => {
    const result = service.calculate(base, '2025-01-01T00:01:00.000Z');
    expect(result.score).toBe(12);
    expect(result.band).toBe('LOW');
    expect(result.confidence).toBe('COMPLETE');
    expect(result.factors.map((factor) => factor.source)).toEqual(['verified-nav', 'venue-account', 'positions', 'closed-fills']);
  });

  it('reduces confidence and does not substitute optimistic defaults for missing data', () => {
    const result = service.calculate(base.slice(0, 1), '2025-01-01T00:01:00.000Z');
    expect(result.score).not.toBeNull();
    expect(result.confidence).toBe('PARTIAL');
    expect(result.factors.find((factor) => factor.key === 'leverage')?.score).toBeNull();
  });

  it('returns unavailable when all inputs are missing or stale', () => {
    const stale = base.map((factor) => ({ ...factor, observedAt: '2024-01-01T00:00:00.000Z' }));
    expect(service.calculate(stale, '2025-01-01T00:00:00.000Z').band).toBe('UNAVAILABLE');
  });

  it('rejects invalid evaluation timestamps and treats negative measurements as invalid', () => {
    expect(() => service.calculate(base, 'not-a-date')).toThrow(TypeError);
    const result = service.calculate([{ ...base[0], value: '-1' }], '2025-01-01T00:01:00.000Z');
    expect(result.factors[0].status).toBe('INVALID');
  });

  it('rejects duplicate factor identities, non-decimal input, and invalid freshness limits', () => {
    const duplicate = service.calculate([...base, base[0]], '2025-01-01T00:01:00.000Z');
    expect(duplicate.factors.find((factor) => factor.key === 'maxDrawdownPercent')).toMatchObject({
      status: 'INVALID',
      value: null,
      score: null,
      source: null,
    });
    expect(duplicate.confidence).toBe('PARTIAL');

    const scientificNotation = service.calculate([{ ...base[0], value: '1e2' }], '2025-01-01T00:01:00.000Z');
    expect(scientificNotation.factors[0]).toMatchObject({ status: 'INVALID', score: null });
    expect(() => service.calculate(base, '2025-01-01T00:01:00.000Z', -1)).toThrow(RangeError);
  });
});

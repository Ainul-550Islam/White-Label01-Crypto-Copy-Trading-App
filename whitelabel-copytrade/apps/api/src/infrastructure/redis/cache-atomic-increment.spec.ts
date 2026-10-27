import { CacheService } from './cache.service';

describe('CacheService atomic increment', () => {
  function serviceWith(results: unknown) {
    const pipeline = { incrby: jest.fn(), expire: jest.fn(), exec: jest.fn().mockResolvedValue(results) };
    const redis = { client: { multi: jest.fn().mockReturnValue(pipeline) } };
    return { service: new CacheService(redis as never, {} as never), pipeline };
  }

  it('returns only an acknowledged counter and expiry result', async () => {
    const { service, pipeline } = serviceWith([[null, 2], [null, 0]]);
    await expect(service.increment('challenge', 60)).resolves.toBe(2);
    expect(pipeline.incrby).toHaveBeenCalledWith('challenge', 1);
    expect(pipeline.expire).toHaveBeenCalledWith('challenge', 60, 'NX');
  });

  it.each([
    { name: 'aborted transaction', results: null },
    { name: 'missing commands', results: [] },
    { name: 'counter error', results: [[new Error('counter failed'), null], [null, 1]] },
    { name: 'expiry error', results: [[null, 1], [new Error('expiry failed'), null]] },
    { name: 'non-numeric counter', results: [[null, 'not a counter'], [null, 1]] },
    { name: 'invalid expiry response', results: [[null, 1], [null, -1]] },
  ])('fails closed on $name', async ({ results }) => {
    const { service } = serviceWith(results);
    await expect(service.increment('challenge', 60)).rejects.toThrow('CACHE_INCREMENT_UNAVAILABLE');
  });
});

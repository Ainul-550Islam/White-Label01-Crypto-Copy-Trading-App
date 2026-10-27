import { validWebhookUrl } from '@/features/developer/webhook-endpoint-form';
import { developerPlatformApi } from '@/api/developer-platform-api';

test('webhook URL validation accepts only the HTTPS shape supported by the service', () => {
  expect(validWebhookUrl('https://hooks.example.test:8443/v1/abc', true)).toBe(false);
  expect(validWebhookUrl('https://hooks.example.test:443/v1/abc', true)).toBe(true);
  expect(validWebhookUrl('http://hooks.example.test/hook', false)).toBe(false);
  expect(validWebhookUrl('https://user:pass@hooks.example.test/hook', false)).toBe(false);
  expect(validWebhookUrl('https://hooks.example.test/hook?token=secret', false)).toBe(false);
  expect(validWebhookUrl('https://localhost/hook', true)).toBe(false);
  expect(validWebhookUrl('https://localhost/hook', false)).toBe(false);
  expect(validWebhookUrl('https://169.254.169.254/hook', false)).toBe(false);
  expect(validWebhookUrl('https://10.0.0.2/hook', false)).toBe(false);
  expect(validWebhookUrl(`https://example.com/${'a'.repeat(500)}`, false)).toBe(false);
  expect(validWebhookUrl('https://bad host/hook', false)).toBe(false);
});

test('manual replay sends the same event ID and mutation key through the real browser client', async () => {
  const originalFetch = global.fetch;
  Object.assign(globalThis, { window: { location: { origin: 'https://admin.example.test' } }, document: { cookie: 'wlct_csrf=test-csrf' } });
  const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { deliveryId: 'delivery-1', eventId: 'event-1' } }), { status: 202 }));
  global.fetch = fetchMock;
  try {
    const result = await developerPlatformApi.replayWebhook('endpoint-1', 'event-1', 'intent-123');
    expect(result.deliveryId).toBe('delivery-1');
    expect(fetchMock).toHaveBeenCalledWith('https://admin.example.test/api/proxy/v1/developer-platform/webhooks/endpoint-1/replay', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ eventId: 'event-1' }),
      headers: expect.objectContaining({ 'Idempotency-Key': 'intent-123', 'x-csrf-token': 'test-csrf' }),
    }));
  } finally { global.fetch = originalFetch; Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document'); }
});


test('secret rotation carries the caller request key and does not send a secret', async () => {
  const originalFetch = global.fetch;
  Object.assign(globalThis, { window: { location: { origin: 'https://admin.example.test' } }, document: { cookie: 'wlct_csrf=test-csrf' } });
  const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { secret: 'one-time-value' } }), { status: 201 }));
  global.fetch = fetchMock;
  try {
    expect(await developerPlatformApi.rotateWebhookSecret('endpoint-1', 'rotate-intent-123')).toEqual({ secret: 'one-time-value' });
    expect(fetchMock).toHaveBeenCalledWith('https://admin.example.test/api/proxy/v1/developer-platform/webhooks/endpoint-1/rotate-secret', expect.objectContaining({
      method: 'POST', body: undefined, headers: expect.objectContaining({ 'Idempotency-Key': 'rotate-intent-123', 'x-csrf-token': 'test-csrf' }),
    }));
  } finally { global.fetch = originalFetch; Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document'); }
});

import { validApplicationRedirects } from '@/features/developer/applications-panel';

test('redirect validation matches production and sandbox backend boundaries', () => {
  expect(validApplicationRedirects(['https://app.example.test/callback'], 'PRODUCTION')).toBe(true);
  expect(validApplicationRedirects(['http://localhost:3000/callback'], 'SANDBOX')).toBe(true);
  expect(validApplicationRedirects(['http://localhost:3000/callback'], 'PRODUCTION')).toBe(false);
  expect(validApplicationRedirects(['https://user:secret@example.test/callback'], 'SANDBOX')).toBe(false);
  expect(validApplicationRedirects(['https://app.example.test:bad/callback'], 'SANDBOX')).toBe(false);
  expect(validApplicationRedirects(['https://app.example.test/callback?token=x'], 'SANDBOX')).toBe(false);
  expect(validApplicationRedirects([], 'SANDBOX')).toBe(false);
  expect(validApplicationRedirects(Array(17).fill('https://app.example.test/callback'), 'SANDBOX')).toBe(false);
});

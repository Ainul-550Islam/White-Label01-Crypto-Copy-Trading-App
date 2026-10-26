// # Confirms realtime delivery publisher is exported while authentication and gateway stay registered.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, './realtime.module.ts'), 'utf8');

describe('RealtimeModule registration contract', () => {
  it('exports RealtimeService and registers the authenticated gateway', () => {
    const providers = source.match(/providers:\s*\[([^\]]*)\]/u)?.[1] ?? '';
    const exports = source.match(/exports:\s*\[([^\]]*)\]/u)?.[1] ?? '';
    const imports = source.match(/imports:\s*\[([^\]]*)\]/u)?.[1] ?? '';

    expect(providers).toContain('RealtimeGateway');
    expect(providers).toContain('RealtimeService');
    expect(exports).toContain('RealtimeService');
    expect(imports).toContain('AuthModule');
  });
});

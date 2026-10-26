// # Responsibility: prevents duplicate exported exchange-provider class implementations in the API source tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceRoot = join(__dirname, '..', '..');
const extensionPattern = /\.(?:ts|tsx)$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.isFile() && extensionPattern.test(entry.name) && !entry.name.endsWith('.spec.ts')) return [path];
    return [];
  });
}

describe('exchange provider implementation uniqueness', () => {
  it('defines each exported *Provider class once under apps/api/src', () => {
    const definitions = new Map<string, string[]>();
    const declaration = /\bexport\s+class\s+([A-Za-z_$][\w$]*Provider)\b/g;
    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(declaration)) {
        const files = definitions.get(match[1]) ?? [];
        files.push(relative(sourceRoot, file));
        definitions.set(match[1], files);
      }
    }
    const duplicates = [...definitions.entries()].filter(([, files]) => files.length > 1);
    expect(duplicates).toEqual([]);
  });
});

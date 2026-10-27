// # Responsibility: proves every step-up route sits on top of an authorisation and that the proof-consuming guard is registered exactly once, after the permissions guard.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Deliberately source-based: importing the controllers would drag the whole
// billing/prisma graph into a metadata test, and the invariant under test is
// itself a source invariant (it is the same one scripts/check-step-up-paths.mjs
// enforces in CI).

const apiSrc = join(__dirname, '..', '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) return [path];
    return [];
  });
}

const ANY_PERMISSION = /@(RequirePermissions|RequireAnyPermission|PlatformOnly)\s*\(/;
const STEP_UP = /@RequireStepUp\(\s*(['"`])([A-Z0-9_]+)\1\s*\)/;

function isDecoratorLine(line: string): boolean {
  const text = line.trim();
  if (text === '') return false;
  if (text.startsWith('@')) return true;
  if (text.startsWith('*') || text.startsWith('/*') || text.startsWith('//')) return true;
  return text === '})' || text.startsWith('}') || text.endsWith(',') || text.endsWith(')');
}

/** The decorator block of the class that textually encloses `index`. */
function enclosingClassDecorators(lines: string[], index: number): string {
  for (let i = index; i >= 0; i--) {
    if (/^export (abstract )?class /.test(lines[i])) {
      const block: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const text = lines[j].trim();
        if (text === '' && block.length === 0) continue;
        if (text.startsWith('@') || text.startsWith('}')) {
          block.push(text);
          continue;
        }
        break;
      }
      return block.join('\n');
    }
  }
  return '';
}

describe('step-up routes and permission metadata', () => {
  it('the billing publication routes require platform:manage on the handler itself', () => {
    const feeSchedule = readFileSync(join(__dirname, 'fee-schedule.controller.ts'), 'utf8');
    const feeLine = feeSchedule.split('\n').find((line) => line.includes("@RequireStepUp('FEE_SCHEDULE_PUBLISH')"));
    expect(feeLine).toBeDefined();
    expect(feeLine).toContain('@RequirePermissions(Permission.PLATFORM_MANAGE)');

    const statements = readFileSync(join(__dirname, 'profit-share-statement.controller.ts'), 'utf8');
    const statementLines = statements
      .split('\n')
      .filter((line) => line.includes("@RequireStepUp('STATEMENT_REGENERATE')"));
    expect(statementLines).toHaveLength(2);
    for (const line of statementLines) {
      expect(line).toContain('@RequirePermissions(Permission.PLATFORM_MANAGE)');
    }
  });

  it('every @RequireStepUp route also carries permission metadata (handler or enclosing class)', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of sourceFiles(apiSrc)) {
      if (!file.endsWith('.controller.ts')) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!STEP_UP.test(lines[i])) continue;
        seen += 1;
        let blockStart = i;
        while (blockStart - 1 >= 0 && isDecoratorLine(lines[blockStart - 1])) blockStart -= 1;
        let blockEnd = i;
        while (blockEnd + 1 < lines.length && isDecoratorLine(lines[blockEnd + 1])) blockEnd += 1;
        const handlerBlock = lines.slice(blockStart, blockEnd + 1).join('\n');
        const classBlock = enclosingClassDecorators(lines, i);
        const selfService = relative(apiSrc, file).endsWith('modules/auth/two-factor.controller.ts');
        if (!selfService && !ANY_PERMISSION.test(handlerBlock) && !ANY_PERMISSION.test(classBlock)) {
          offenders.push(`${relative(apiSrc, file)}:${i + 1}`);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('registers the step-up guard as a global guard exactly once, after the permissions guard', () => {
    const registrations: string[] = [];
    for (const file of sourceFiles(apiSrc)) {
      const source = readFileSync(file, 'utf8');
      for (const _match of source.matchAll(
        /useExisting:\s*StepUpGuard|provide:\s*APP_GUARD,\s*useClass:\s*StepUpGuard/g,
      )) {
        void _match;
        registrations.push(relative(apiSrc, file));
      }
    }
    expect(registrations).toEqual(['app.module.ts']);

    const appModule = readFileSync(join(apiSrc, 'app.module.ts'), 'utf8');
    const permissionsAt = appModule.indexOf('useClass: PermissionsGuard');
    const stepUpAt = appModule.indexOf('useExisting: StepUpGuard');
    expect(permissionsAt).toBeGreaterThanOrEqual(0);
    expect(stepUpAt).toBeGreaterThan(permissionsAt);
  });
});

/**
 * Tests for the query-parameter half of the client -> API contract check
 * (run: `node --test scripts/`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qc = require('./api-query-contract.js');

function walk(dir, filter, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, filter, out);
    else if (filter(f)) out.push(f);
  }
  return out;
}

test('object literal keys: plain, quoted, shorthand, spread, Dart collection-if', () => {
  assert.deepEqual(qc.literalKeys(`{ page, limit: 20, "status": s }`, 0), { keys: ['page', 'limit', 'status'], partial: false });
  assert.deepEqual(qc.literalKeys(`{ ...base, search }`, 0), { keys: ['search'], partial: true });
  const dart = `{'sortBy': sortBy, 'page': 1, if (search != null && search.isNotEmpty) 'search': search}`;
  assert.deepEqual(qc.literalKeys(dart, 0), { keys: ['sortBy', 'page', 'search'], partial: false });
});

test('query keys from call arguments, including a local variable and later assignments', () => {
  const web = `apiClient.get("/v1/x", { searchParams: { page: 1, status } })`;
  assert.deepEqual(qc.queryKeysFromArgs(web, 'searchParams', web, 0).keys, ['page', 'status']);

  const file = [
    `final Map<String, Object?> query = <String, Object?>{'profileId': id};`,
    `query['from'] = from;`,
    `await _apiClient.get(ApiEndpoints.pnl, queryParameters: query, parser: f);`,
  ].join('\n');
  const at = file.indexOf('_apiClient');
  const args = file.slice(file.indexOf('(', at));
  assert.deepEqual(qc.queryKeysFromArgs(args, 'queryParameters', file, at).keys, ['profileId', 'from']);
  assert.equal(qc.queryKeysFromArgs(`(path, { body })`, 'searchParams', '', 0), null);
});

test('inline query strings', () => {
  assert.deepEqual(qc.inlineQueryKeys('/v1/x?status=${}&page=1'), { keys: ['status', 'page'], partial: false });
  assert.equal(qc.inlineQueryKeys('/v1/x'), null);
});

test('route query contract: DTO, individual keys, none', () => {
  const src = [
    `  @Get('a')`,
    `  @ApiQuery({ name: 'x' })`,
    `  async a(@Query() query: ListThingsDto) {}`,
    `  @Get('b')`,
    `  async b(@Query('status') status?: string, @Query('page') page?: string) {}`,
    `  @Get('c')`,
    `  async c(@Param('id', ParseUuidPipe) id: string) {}`,
  ].join('\n');
  const idx = [...src.matchAll(/@Get/g)].map((m) => m.index);
  assert.deepEqual(qc.routeQuery(src, idx[0], idx[1]), { mode: 'dto', dto: 'ListThingsDto' });
  assert.deepEqual(qc.routeQuery(src, idx[1], idx[2]), { mode: 'keys', keys: ['status', 'page'] });
  assert.deepEqual(qc.routeQuery(src, idx[2], src.length), { mode: 'none' });
});

test('DTO resolution through extends and mapped types, and the problems reported', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qc-'));
  try {
    mkdirSync(path.join(dir, 'dto'));
    writeFileSync(
      path.join(dir, 'dto', 'a.dto.ts'),
      [
        `export class PaginationQueryDto {`,
        `  @IsOptional() @Max(100, { message: 'limit: max' }) limit?: number;`,
        `  @IsOptional() page?: number;`,
        `}`,
        `export class ListThingsDto extends PaginationQueryDto {`,
        `  @IsOptional() @IsEnum(S) status?: S;`,
        `  get computed(): string { return ''; }`,
        `}`,
        `export class CreateThingDto { name!: string; secret!: string; }`,
        `export class PatchThingDto extends PartialType(OmitType(CreateThingDto, ['secret'] as const)) {}`,
      ].join('\n'),
    );
    const classes = qc.dtoIndex(walk, dir);
    assert.deepEqual([...qc.resolveDto(classes, 'ListThingsDto')].sort(), ['limit', 'page', 'status']);
    assert.deepEqual([...qc.resolveDto(classes, 'PatchThingDto')], ['name']);
    assert.equal(qc.resolveDto(classes, 'Missing'), null);

    const route = { query: { mode: 'dto', dto: 'ListThingsDto' } };
    assert.equal(qc.queryProblem({ query: { keys: ['page', 'status'] } }, route, classes), null);
    assert.match(qc.queryProblem({ query: { keys: ['search'] } }, route, classes), /'search' not declared by ListThingsDto -> 422/);

    const keysRoute = { query: { mode: 'keys', keys: ['status'] } };
    assert.match(qc.queryProblem({ query: { keys: ['status', 'sort'] } }, keysRoute, classes), /'sort' silently ignored/);
    assert.match(qc.queryProblem({ query: { keys: ['q'] } }, { query: { mode: 'none' } }, classes), /no query parameters/);
    // Untyped `@Query() q: any` handlers cannot be checked statically.
    assert.equal(qc.queryProblem({ query: { keys: ['x'] } }, { query: { mode: 'dto', dto: 'any' } }, classes), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

'use strict';
/**
 * Query-parameter half of the web/admin/mobile -> API contract check.
 *
 * Matching paths is not enough: the API's global validation pipe runs with
 * `whitelist` + `forbidNonWhitelisted`, so a client that sends a query key the
 * handler's `@Query()` DTO does not declare gets a 422 even though the route
 * exists (the customer strategies page sent `search` and failed this way).
 * Handlers that read individual keys (`@Query('status')`) silently ignore
 * anything else, which means a filter the UI shows has no effect.
 *
 * API side: each route's handler parameters are parsed for `@Query() x: Dto`
 * (DTO properties resolved through `extends`, PartialType, PickType, OmitType
 * and IntersectionType) or `@Query('key')`. Client side: literal keys of web
 * `searchParams: {...}`, inline `?a=..&b=..` paths and mobile
 * `queryParameters: {...}` maps, following one level of local variable.
 * Anything that cannot be resolved statically is skipped, never guessed.
 */
const fs = require('fs');
const path = require('path');

/** Index of `src` just after the bracket that closes the one at `open`. */
function balancedEnd(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      const end = balancedEnd(src, j + 1);
      if (end < 0) return src.length;
      j = end - 1;
      continue;
    }
    if (src[j] === q) return j;
  }
  return src.length;
}

/** Split the inside of a bracketed literal into its top-level comma segments. */
function topLevelSegments(src, open, close) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close - 1; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start, close - 1));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Keys of an object/map literal whose `{` is at `open`.
 * Returns { keys, partial } (partial = a spread or computed key was present).
 */
function literalKeys(src, open) {
  const close = balancedEnd(src, open);
  if (close < 0) return null;
  const keys = [];
  let partial = false;
  for (let seg of topLevelSegments(src, open, close)) {
    seg = seg.replace(/^(?:\/\/[^\n]*\n\s*)+/, '');
    // Dart collection-if: `if (cond) 'key': value`
    while (/^if\s*\(/.test(seg)) {
      const end = balancedEnd(seg, seg.indexOf('('));
      if (end < 0) break;
      seg = seg.slice(end).trim();
    }
    if (seg.startsWith('...')) {
      partial = true;
      continue;
    }
    const kv = /^(['"]?)([A-Za-z_$][\w$-]*)\1\s*:/.exec(seg);
    if (kv) {
      keys.push(kv[2]);
      continue;
    }
    const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(seg);
    if (shorthand) {
      keys.push(shorthand[1]);
      continue;
    }
    partial = true;
  }
  return { keys, partial };
}

/**
 * Keys passed under `prop` (searchParams / queryParameters) in a call's
 * argument text. `fileSrc` is used to follow `prop: someVariable`.
 */
function queryKeysFromArgs(args, prop, fileSrc, callIndex) {
  const re = new RegExp(`\\b${prop}\\s*:\\s*`);
  const m = re.exec(args);
  if (!m) return null;
  let rest = args.slice(m.index + m[0].length);
  rest = rest.replace(/^(?:const\s+)?<[^>]*>\s*/, '');
  if (rest.startsWith('{')) return literalKeys(rest, 0);
  const ident = /^([A-Za-z_$][\w$]*)\s*[,)\n}]/.exec(rest + '\n');
  if (!ident) return null;
  // Nearest preceding `name = {` / `name = <K, V>{` definition in the file.
  const defRe = new RegExp(`\\b${ident[1]}\\s*(?::[^=;\\n]+)?=\\s*(?:const\\s+)?(?:<[^>]*>\\s*)?\\{`, 'g');
  let def = null;
  let d;
  while ((d = defRe.exec(fileSrc)) !== null && d.index < callIndex) def = d;
  if (!def) return null;
  const brace = def.index + def[0].length - 1;
  const res = literalKeys(fileSrc, brace);
  if (!res) return null;
  // Keys added later with `name['key'] = ...` / `name.key = ...` / `name.set('key', ...)`.
  const tail = fileSrc.slice(brace, callIndex);
  for (const a of tail.matchAll(new RegExp(`\\b${ident[1]}(?:\\[['"]([\\w-]+)['"]\\]|\\.(?:set|append)\\(\\s*['"]([\\w-]+)['"])`, 'g'))) {
    res.keys.push(a[1] || a[2]);
  }
  return res;
}

/** Keys of an inline query string in a raw client path (`/x?status=${}&page=1`). */
function inlineQueryKeys(raw) {
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const keys = [];
  let partial = false;
  for (const part of raw.slice(q + 1).split('&')) {
    const k = /^([A-Za-z_][\w-]*)=/.exec(part);
    if (k) keys.push(k[1]);
    else if (part.length > 0) partial = true;
  }
  return { keys, partial };
}

// ---------------------------------------------------------------- API side

/** Class name -> { props:Set|null, ext: string|null } across apps/api/src. */
function dtoIndex(walk, apiSrc) {
  const classes = new Map();
  for (const file of walk(apiSrc, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /\bclass\s+(\w+)\s*(?:<[^>{]*>)?\s*(extends\s+([^{]+?))?\s*(?:implements\s+[^{]+)?\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = balancedEnd(src, open);
      if (close < 0) continue;
      const props = new Set();
      // Top-level text of the class body only (decorator arguments, method
      // bodies and initialisers are nested and therefore skipped).
      let depth = 0;
      let line = '';
      const lines = [];
      for (let i = open + 1; i < close - 1; i++) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
          const end = skipString(src, i);
          if (depth === 0) line += 'S';
          i = end;
          continue;
        }
        if (c === '(' || c === '{' || c === '[') {
          if (depth === 0) line += c;
          depth++;
          continue;
        }
        if (c === ')' || c === '}' || c === ']') {
          depth--;
          if (depth === 0) line += c;
          continue;
        }
        if (depth === 0) {
          if (c === '\n') {
            lines.push(line);
            line = '';
          } else line += c;
        }
      }
      lines.push(line);
      for (const l of lines) {
        const p = /^\s*(?:@\w+\(\)\s*)*(?:(?:public|private|protected|readonly|declare)\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*:/.exec(l);
        if (p && !/^\s*(?:get|set|static|async|constructor)\b/.test(l)) props.add(p[1]);
      }
      classes.set(m[1], { props, ext: m[3] ? m[3].trim() : null, file });
    }
  }
  return classes;
}

function resolveDto(classes, expr, seen = new Set()) {
  expr = expr.trim();
  const call = /^(PartialType|PickType|OmitType|IntersectionType)\s*\(([\s\S]*)\)$/.exec(expr);
  if (call) {
    const args = splitArgs(call[2]);
    if (call[1] === 'PartialType') return resolveDto(classes, args[0] || '', seen);
    if (call[1] === 'IntersectionType') {
      const all = new Set();
      for (const a of args) {
        const r = resolveDto(classes, a, seen);
        if (!r) return null;
        r.forEach((k) => all.add(k));
      }
      return all;
    }
    const base = resolveDto(classes, args[0] || '', seen);
    const listed = [...(args[1] || '').matchAll(/['"](\w+)['"]/g)].map((x) => x[1]);
    if (!base) return null;
    if (call[1] === 'PickType') return new Set(listed.filter((k) => base.has(k)));
    return new Set([...base].filter((k) => !listed.includes(k)));
  }
  const name = /^([A-Za-z_$][\w$]*)/.exec(expr);
  if (!name || seen.has(name[1])) return null;
  const cls = classes.get(name[1]);
  if (!cls) return null;
  seen.add(name[1]);
  const out = new Set(cls.props);
  if (cls.ext) {
    const parent = resolveDto(classes, cls.ext, seen);
    if (!parent) return null;
    parent.forEach((k) => out.add(k));
  }
  return out;
}

function splitArgs(text) {
  const src = `(${text})`;
  return topLevelSegments(src, 0, src.length);
}

/**
 * Query contract for a route decorator found at `index` in a controller:
 *   { mode: 'dto', dto } | { mode: 'keys', keys } | { mode: 'none' } | null
 */
function routeQuery(src, index, nextIndex) {
  const seg = src.slice(index, nextIndex);
  // First method header that is not a decorator line.
  const header = /\n\s*(?:(?:public|private|protected)\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  let h;
  while ((h = header.exec(seg)) !== null) {
    const lineStart = seg.lastIndexOf('\n', h.index + 1);
    if (!/^\s*@/.test(seg.slice(lineStart + 1))) break;
  }
  if (!h) return null;
  const open = h.index + h[0].length - 1;
  const close = balancedEnd(seg, open);
  if (close < 0) return null;
  const params = seg.slice(open, close);
  const dto = /@Query\(\s*(?:[A-Z]\w*(?:\([^)]*\))?\s*)?\)\s*(?:\w+\s+)?\w+\s*[?]?\s*:\s*([A-Za-z_$][\w$]*)/.exec(params);
  if (dto) return { mode: 'dto', dto: dto[1] };
  const keys = [...params.matchAll(/@Query\(\s*['"]([\w-]+)['"]/g)].map((x) => x[1]);
  if (keys.length > 0) return { mode: 'keys', keys };
  if (/@Query\(/.test(params)) return null; // something we do not understand
  return { mode: 'none' };
}

/** Problems for one call against its matched route, or null when fine/unknown. */
function queryProblem(call, route, classes) {
  if (!call.query || call.query.keys.length === 0 || !route.query) return null;
  const sent = [...new Set(call.query.keys)];
  if (route.query.mode === 'dto') {
    if (/^(Record|Object|any|unknown)$/.test(route.query.dto)) return null;
    const props = resolveDto(classes, route.query.dto);
    if (!props) return null;
    const unknown = sent.filter((k) => !props.has(k));
    if (unknown.length === 0) return null;
    return `query ${unknown.map((k) => `'${k}'`).join(', ')} not declared by ${route.query.dto} -> 422 (accepts: ${[...props].sort().join(', ') || 'none'})`;
  }
  const accepted = route.query.mode === 'keys' ? route.query.keys : [];
  const unknown = sent.filter((k) => !accepted.includes(k));
  if (unknown.length === 0) return null;
  return `query ${unknown.map((k) => `'${k}'`).join(', ')} silently ignored by the handler (reads: ${accepted.join(', ') || 'no query parameters'})`;
}

module.exports = {
  balancedEnd,
  dtoIndex,
  inlineQueryKeys,
  literalKeys,
  queryKeysFromArgs,
  queryProblem,
  resolveDto,
  routeQuery,
};

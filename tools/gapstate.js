#!/usr/bin/env node
// Reports, per GAP, which evidence criteria are still unsatisfied and exactly which pattern is
// missing from which file.
//
// The scanner's console output says only "Required behavior/assertion signal is absent"; this says
// which literal it looked for. That distinction matters: it separates "the behaviour is missing"
// from "the behaviour is there and the probe looks for a different identifier".
//
// Usage: node /home/user/tools/gapstate.js [GAP-54 GAP-97 ...]      (default: all gaps)
//        node /home/user/tools/gapstate.js --missing-only
'use strict';
const path = require('path');
const ROOT = '/home/user/repo/whitelabel-copytrade';
const scanner = require(path.join(ROOT, 'ops/gap-parity-scanner-51-100.js'));

const args = process.argv.slice(2);
const missingOnly = args.includes('--missing-only');
const wanted = args.filter((a) => a.startsWith('GAP-'));
const gaps = wanted.length ? scanner.GAP_CHECKS.filter((g) => wanted.includes(g.id)) : scanner.GAP_CHECKS;

let total = 0;
let absent = 0;
let unmet = 0;
for (const gap of gaps) {
  const evaluated = scanner.evaluateGap(gap, ROOT);
  const satisfied = evaluated.criteria.filter((c) => c.satisfied).length;
  const lines = [];
  for (const c of evaluated.criteria) {
    if (c.satisfied) continue;
    for (const p of c.probeResults) {
      if (p.matched) continue;
      if (p.reason === 'Required behavior/assertion signal is absent') {
        absent++;
        if (missingOnly) continue;
        lines.push(`   UNSAT [${c.key}] FILE PRESENT, MISSING PATTERN(S) IN ${p.file}:`);
        for (const m of p.missingPatterns || []) lines.push(`        /${m}/`);
      } else {
        unmet++;
        if (missingOnly) continue;
        lines.push(`   UNSAT [${c.key}] ${p.reason}: ${p.file}`);
      }
    }
  }
  total++;
  if (lines.length === 0 && !missingOnly) {
    console.log(`${gap.id}: ${satisfied}/${evaluated.criteria.length} criteria satisfied`);
  } else {
    console.log(`${gap.id}: ${satisfied}/${evaluated.criteria.length} criteria satisfied`);
    for (const l of lines) console.log(l);
  }
}

console.log(`\n${total} gaps evaluated`);
console.log(`  criteria blocked by a MISSING PATTERN in an existing file (could be a probe mismatch): ${absent}`);
console.log(`  criteria blocked by a MISSING FILE: ${unmet}`);

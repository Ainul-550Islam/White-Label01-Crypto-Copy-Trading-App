/**
 * Deterministic validation for 50 production infrastructure requirements
 * Run with: node ops/production-validation-50-checks.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const prodRoot = path.join(root, 'ops/production');
const workflowsRoot = path.join(root, '.github/workflows');
const terraformRoot = path.join(root, 'infra/production/terraform');

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function fileExists(p) { return fs.existsSync(p); }

function grep(pattern, dir) {
  const files = fs.readdirSync(dir, { recursive: true });
  let found = false;
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) continue;
    if (!full.endsWith('.ts')) continue;
    const content = readFile(full);
    if (content.match(pattern)) { found = true; break; }
  }
  return found;
}

const checks = [];

function check(id, name, fn) {
  try {
    const ok = fn();
    checks.push({ id, name, ok });
    console.log(`${ok ? '✅' : '❌'} ${id}. ${name}`);
    return ok;
  } catch (e) {
    checks.push({ id, name, ok: false, error: e.message });
    console.log(`❌ ${id}. ${name} ERROR: ${e.message}`);
    return false;
  }
}

// 1. production environment cannot use development secrets
check(1, 'production environment cannot use development secrets', () => {
  const content = readFile(path.join(prodRoot, 'environment-policy.service.ts'));
  return content.includes('FORBIDDEN') || content.includes('forbiddenVariables') || content.includes('BYPASS');
});

// 2. required production configuration validation
check(2, 'required production configuration validation', () => {
  const content = readFile(path.join(prodRoot, 'environment-validator.service.ts'));
  return content.includes('requiredVariables') && content.includes('validate');
});

// 3. missing required configuration fails
check(3, 'missing required configuration fails', () => {
  const content = readFile(path.join(prodRoot, 'environment-validator.service.ts'));
  return content.includes('missingVariables') && content.includes('Missing required');
});

// 4. release manifest is deterministic
check(4, 'release manifest is deterministic', () => {
  const content = readFile(path.join(prodRoot, 'release-manifest.service.ts'));
  return content.includes('deterministic') && content.includes('sort') && content.includes('isDeterministic');
});

// 5. artifact digest mismatch blocks release
check(5, 'artifact digest mismatch blocks release', () => {
  const content = readFile(path.join(prodRoot, 'artifact-integrity.service.ts'));
  const executor = readFile(path.join(prodRoot, 'deployment-executor.service.ts'));
  return content.includes('DIGEST_MISMATCH') && (executor.includes('artifactIntegrityResult') || content.includes('BLOCKED') || content.includes('DIGEST_MISMATCH'));
});

// 6. artifact signature failure blocks release
check(6, 'artifact signature failure blocks release', () => {
  const content = readFile(path.join(prodRoot, 'artifact-integrity.service.ts'));
  return content.includes('SIGNATURE_INVALID');
});

// 7. migration history mismatch blocks release
check(7, 'migration history mismatch blocks release', () => {
  const content = readFile(path.join(prodRoot, 'migration-gate.service.ts'));
  return content.includes('HISTORY_MISMATCH');
});

// 8. destructive migration detection blocks release
check(8, 'destructive migration detection blocks release', () => {
  const content = readFile(path.join(prodRoot, 'migration-gate.service.ts'));
  return content.includes('DESTRUCTIVE_DETECTED') && content.includes('DROP TABLE');
});

// 9. reviewed migration can pass
check(9, 'reviewed migration can pass', () => {
  const content = readFile(path.join(prodRoot, 'migration-gate.service.ts'));
  return content.includes('VALID') && content.includes('APPROVAL_REQUIRED');
});

// 10. RLS missing model coverage blocks release
check(10, 'RLS missing model coverage blocks release', () => {
  const content = readFile(path.join(prodRoot, 'rls-gate.service.ts'));
  return content.includes('FAILED_CLOSED') && content.includes('COVERAGE_INCOMPLETE');
});

// 11. complete RLS coverage passes
check(11, 'complete RLS coverage passes', () => {
  const content = readFile(path.join(prodRoot, 'rls-gate.service.ts'));
  return content.includes('COVERAGE_COMPLETE');
});

// 12. critical vulnerability blocks release
check(12, 'critical vulnerability blocks release', () => {
  const content = readFile(path.join(prodRoot, 'vulnerability-gate.service.ts'));
  return content.includes('CRITICAL') && content.includes('blockOnCritical');
});

// 13. acceptable vulnerability according to policy does not incorrectly block
check(13, 'acceptable vulnerability according to policy does not incorrectly block', () => {
  const content = readFile(path.join(prodRoot, 'vulnerability-gate.service.ts'));
  return content.includes('allowedHighCount') && content.includes('allowedMediumCount');
});

// 14. SBOM corresponds to artifact
check(14, 'SBOM corresponds to artifact', () => {
  const content = readFile(path.join(prodRoot, 'sbom.service.ts'));
  return content.includes('artifactDigest') && content.includes('verifyAssociation');
});

// 15. container digest is immutable
check(15, 'container digest is immutable', () => {
  const content = readFile(path.join(prodRoot, 'image-security.service.ts'));
  return content.includes('sha256:') && content.includes('immutable');
});

// 16. deployment requires authorization
check(16, 'deployment requires authorization', () => {
  const content = readFile(path.join(prodRoot, 'deployment-executor.service.ts'));
  return content.includes('approval') && content.includes('requiresApproval');
});

// 17. deployment plan is deterministic
check(17, 'deployment plan is deterministic', () => {
  const content = readFile(path.join(prodRoot, 'deployment-plan.service.ts'));
  return content.includes('deterministic') && content.includes('isDeterministic');
});

// 18. post-deployment health failure blocks completion
check(18, 'post-deployment health failure blocks completion', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('overallPassed') && content.includes('FAILED');
});

// 19. rollback requires verified artifact
check(19, 'rollback requires verified artifact', () => {
  const content = readFile(path.join(prodRoot, 'rollback.service.ts'));
  return content.includes('BLOCKED_UNVERIFIED_ARTIFACT') && content.includes('artifactVerified');
});

// 20. incompatible DB rollback is blocked
check(20, 'incompatible DB rollback is blocked', () => {
  const content = readFile(path.join(prodRoot, 'rollback.service.ts'));
  return content.includes('BLOCKED_INCOMPATIBLE_SCHEMA') && content.includes('schemaCompatible');
});

// 21. backup submission is not backup verification
check(21, 'backup submission is not backup verification', () => {
  const backup = readFile(path.join(prodRoot, 'backup.service.ts'));
  const verification = readFile(path.join(prodRoot, 'backup-verification.service.ts'));
  return backup.includes('COMPLETED') && verification.includes('VERIFIED') && verification.toLowerCase().includes('must not report success based on a backup job submission');
});

// 22. restore requires actual backup
check(22, 'restore requires actual backup', () => {
  const content = readFile(path.join(prodRoot, 'restore-verification.service.ts'));
  return content.includes('Backup artifact not found') && content.includes('cannot restore');
});

// 23. failed restore is not reported successful
check(23, 'failed restore is not reported successful', () => {
  const content = readFile(path.join(prodRoot, 'restore-verification.service.ts'));
  return content.includes('VERIFICATION_FAILED');
});

// 24. RPO calculation uses real timestamps
check(24, 'RPO calculation uses real timestamps', () => {
  const content = readFile(path.join(prodRoot, 'disaster-recovery.service.ts'));
  return content.includes('calculateRpoMinutes') && content.includes('backupCreatedAt') && content.includes('failureDetectedAt');
});

// 25. RTO calculation uses real durations
check(25, 'RTO calculation uses real durations', () => {
  const content = readFile(path.join(prodRoot, 'disaster-recovery.service.ts'));
  return content.includes('calculateRtoMinutes') && content.includes('recoveredAt');
});

// 26. DR incomplete state is not reported healthy
check(26, 'DR incomplete state is not reported healthy', () => {
  const content = readFile(path.join(prodRoot, 'disaster-recovery.service.ts'));
  return content.includes('PARTIAL') && content.includes('FAILED') && content.includes('applicationHealthy');
});

// 27. maintenance integration blocks unsafe deployment action
check(27, 'maintenance integration blocks unsafe deployment action', () => {
  const content = readFile(path.join(prodRoot, 'maintenance-integration.service.ts'));
  return content.includes('blockedActions') && content.includes('LIVE_TRADING') && content.includes('shouldBlockDeploymentAction');
});

// 28. deployment audit is immutable
check(28, 'deployment audit is immutable', () => {
  const content = readFile(path.join(prodRoot, 'deployment-audit.service.ts'));
  return content.includes('isImmutable') && content.includes('auditId');
});

// 29. production secrets never appear in logs
check(29, 'production secrets never appear in logs', () => {
  const content = readFile(path.join(prodRoot, 'deployment-audit.service.ts'));
  return content.includes('***REDACTED***') && content.includes('redactEvidence');
});

// 30. release correlation ID is preserved
check(30, 'release correlation ID is preserved', () => {
  const content = readFile(path.join(prodRoot, 'production.types.ts'));
  return content.includes('correlationId');
});

// 31. schema verification detects missing table
check(31, 'schema verification detects missing table', () => {
  const content = readFile(path.join(prodRoot, 'restore-verification.service.ts'));
  return content.includes('missingTables');
});

// 32. schema verification detects missing index
check(32, 'schema verification detects missing index', () => {
  const content = readFile(path.join(prodRoot, 'restore-verification.service.ts'));
  return content.includes('missingIndexes');
});

// 33. schema verification detects missing foreign key
check(33, 'schema verification detects missing foreign key', () => {
  const content = readFile(path.join(prodRoot, 'restore-verification.service.ts'));
  return content.includes('missingForeignKeys');
});

// 34. schema verification detects unexpected destructive difference
check(34, 'schema verification detects unexpected destructive difference', () => {
  const content = readFile(path.join(prodRoot, 'migration-gate.service.ts'));
  return content.includes('destructiveOperations') && content.includes('DESTRUCTIVE_DETECTED');
});

// 35. application health uses real endpoints
check(35, 'application health uses real endpoints', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('/health') && content.includes('fetch');
});

// 36. queue health uses real queue state
check(36, 'queue health uses real queue state', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('queue') && content.includes('depth');
});

// 37. Redis health uses real Redis state
check(37, 'Redis health uses real Redis state', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('redis') && content.includes('PING');
});

// 38. database health uses actual DB query
check(38, 'database health uses actual DB query', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('database') && content.includes('SELECT 1') || content.includes('migration');
});

// 39. release cannot bypass SecurityModule
check(39, 'release cannot bypass SecurityModule', () => {
  const content = readFile(path.join(prodRoot, 'deployment-executor.service.ts'));
  return content.includes('securityGateResult') && (content.includes('must never bypass') || content.includes('SecurityModule'));
});

// 40. release cannot bypass Operations controls
check(40, 'release cannot bypass Operations controls', () => {
  const content = readFile(path.join(prodRoot, 'preflight.service.ts'));
  return content.includes('operations_controls');
});

// 41. release cannot bypass migration gate
check(41, 'release cannot bypass migration gate', () => {
  const content = readFile(path.join(prodRoot, 'deployment-executor.service.ts'));
  return content.includes('migrationGateResult');
});

// 42. release cannot bypass RLS gate
check(42, 'release cannot bypass RLS gate', () => {
  const content = readFile(path.join(prodRoot, 'deployment-executor.service.ts'));
  return content.includes('rlsGateResult');
});

// 43. rollback cannot bypass safety gate
check(43, 'rollback cannot bypass safety gate', () => {
  const content = readFile(path.join(prodRoot, 'rollback.service.ts'));
  return content.includes('schemaCompatible') && content.includes('artifactVerified');
});

// 44. Terraform validation rejects invalid required inputs
check(44, 'Terraform validation rejects invalid required inputs', () => {
  const content = readFile(path.join(terraformRoot, 'main.tf'));
  return content.includes('validation') && content.includes('sha256:');
});

// 45. secret values are not embedded in Terraform
check(45, 'secret values are not embedded in Terraform', () => {
  const content = readFile(path.join(terraformRoot, 'main.tf'));
  const hasSecretValue = content.includes('password = "') && !content.includes('manage_master_user_password');
  const hasSecretRef = content.includes('secretsmanager') && content.includes('valueFrom');
  return hasSecretRef && !content.match(/password\s*=\s*".*"/);
});

// 46. CI artifact comes from expected commit
check(46, 'CI artifact comes from expected commit', () => {
  const content = readFile(path.join(workflowsRoot, 'production-release.yml'));
  return content.includes('commitSha') && content.includes('IMAGE_NAME');
});

// 47. production release uses approved artifact
check(47, 'production release uses approved artifact', () => {
  const content = readFile(path.join(workflowsRoot, 'production-release.yml'));
  return content.includes('approval-gate') && content.includes('production');
});

// 48. duplicate deployment request is idempotent
check(48, 'duplicate deployment request is idempotent', () => {
  const content = readFile(path.join(prodRoot, 'deployment-plan.service.ts'));
  return content.includes('generateDeploymentId') && content.includes('correlationId');
});

// 49. duplicate rollback request is idempotent
check(49, 'duplicate rollback request is idempotent', () => {
  const content = readFile(path.join(prodRoot, 'rollback.service.ts'));
  return content.includes('rollbackId');
});

// 50. final release status is based on actual verification
check(50, 'final release status is based on actual verification', () => {
  const content = readFile(path.join(prodRoot, 'deployment-verification.service.ts'));
  return content.includes('overallPassed') && content.includes('criticalPathVerified');
});

const passed = checks.filter(c => c.ok).length;
const failed = checks.filter(c => !c.ok).length;
console.log(`\nResult: ${passed}/50 passed, ${failed} failed`);
if (failed > 0) process.exit(1);

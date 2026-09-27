/**
 * Production Infrastructure, CI/CD, Security Supply Chain & Deployment Control Plane
 * Canonical types and state machines
 *
 * This file defines the authoritative state models for release, deployment, migration,
 * backup, restore, rollback, artifact, security gates, readiness and DR.
 * All state transitions are explicit and auditable.
 */

export enum EnvironmentName {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

export enum ReleaseStatus {
  CREATED = 'CREATED',
  BUILDING = 'BUILDING',
  BUILT = 'BUILT',
  SECURITY_GATES_RUNNING = 'SECURITY_GATES_RUNNING',
  SECURITY_GATES_FAILED = 'SECURITY_GATES_FAILED',
  SECURITY_GATES_PASSED = 'SECURITY_GATES_PASSED',
  MANIFEST_CREATED = 'MANIFEST_CREATED',
  ARTIFACT_SIGNED = 'ARTIFACT_SIGNED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  VERIFYING = 'VERIFYING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum DeploymentStatus {
  PLANNED = 'PLANNED',
  PREFLIGHT_RUNNING = 'PREFLIGHT_RUNNING',
  PREFLIGHT_FAILED = 'PREFLIGHT_FAILED',
  PREFLIGHT_PASSED = 'PREFLIGHT_PASSED',
  MIGRATION_GATE_RUNNING = 'MIGRATION_GATE_RUNNING',
  MIGRATION_GATE_FAILED = 'MIGRATION_GATE_FAILED',
  MIGRATION_GATE_PASSED = 'MIGRATION_GATE_PASSED',
  RLS_GATE_RUNNING = 'RLS_GATE_RUNNING',
  RLS_GATE_FAILED = 'RLS_GATE_FAILED',
  RLS_GATE_PASSED = 'RLS_GATE_PASSED',
  SECURITY_GATE_RUNNING = 'SECURITY_GATE_RUNNING',
  SECURITY_GATE_FAILED = 'SECURITY_GATE_FAILED',
  SECURITY_GATE_PASSED = 'SECURITY_GATE_PASSED',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  EXECUTED = 'EXECUTED',
  VERIFYING = 'VERIFYING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum MigrationGateStatus {
  PENDING = 'PENDING',
  VALIDATING = 'VALIDATING',
  VALID = 'VALID',
  INVALID = 'INVALID',
  DESTRUCTIVE_DETECTED = 'DESTRUCTIVE_DETECTED',
  PENDING_MIGRATIONS = 'PENDING_MIGRATIONS',
  HISTORY_MISMATCH = 'HISTORY_MISMATCH',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
}

export enum RlsGateStatus {
  PENDING = 'PENDING',
  VALIDATING = 'VALIDATING',
  COVERAGE_COMPLETE = 'COVERAGE_COMPLETE',
  COVERAGE_INCOMPLETE = 'COVERAGE_INCOMPLETE',
  ARTIFACT_MISSING = 'ARTIFACT_MISSING',
  FAILED_CLOSED = 'FAILED_CLOSED',
}

export enum ArtifactIntegrityStatus {
  PENDING = 'PENDING',
  VERIFYING = 'VERIFYING',
  VERIFIED = 'VERIFIED',
  DIGEST_MISMATCH = 'DIGEST_MISMATCH',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  MANIFEST_MISMATCH = 'MANIFEST_MISMATCH',
  NOT_FOUND = 'NOT_FOUND',
}

export enum SecurityGateStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  BLOCKED = 'BLOCKED',
}

export enum VulnerabilitySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ImageSecurityStatus {
  PENDING = 'PENDING',
  VERIFYING = 'VERIFYING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  BASE_IMAGE_VIOLATION = 'BASE_IMAGE_VIOLATION',
  CRITICAL_VULNERABILITY = 'CRITICAL_VULNERABILITY',
}

export enum SbomStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  GENERATED = 'GENERATED',
  VERIFIED = 'VERIFIED',
  MISMATCH = 'MISMATCH',
  MISSING = 'MISSING',
}

export enum BackupStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  VERIFIED = 'VERIFIED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  EXPIRED = 'EXPIRED',
}

export enum RestoreStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  VERIFIED = 'VERIFIED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
}

export enum RollbackStatus {
  PENDING = 'PENDING',
  VALIDATING = 'VALIDATING',
  APPROVED = 'APPROVED',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  BLOCKED_INCOMPATIBLE_SCHEMA = 'BLOCKED_INCOMPATIBLE_SCHEMA',
  BLOCKED_UNVERIFIED_ARTIFACT = 'BLOCKED_UNVERIFIED_ARTIFACT',
}

export enum DisasterRecoveryStatus {
  IDLE = 'IDLE',
  ASSESSING = 'ASSESSING',
  RECOVERING = 'RECOVERING',
  RECOVERED = 'RECOVERED',
  FAILED = 'FAILED',
  PARTIAL = 'PARTIAL',
  VERIFIED = 'VERIFIED',
}

export enum ProductionReadinessStatus {
  UNKNOWN = 'UNKNOWN',
  ASSESSING = 'ASSESSING',
  READY = 'READY',
  NOT_READY = 'NOT_READY',
  DEGRADED = 'DEGRADED',
}

export enum MaintenanceIntegrationStatus {
  IDLE = 'IDLE',
  ENTERING_MAINTENANCE = 'ENTERING_MAINTENANCE',
  MAINTENANCE = 'MAINTENANCE',
  EXITING_MAINTENANCE = 'EXITING_MAINTENANCE',
  FAILED = 'FAILED',
}

export enum DeploymentStrategy {
  RECREATE = 'RECREATE',
  ROLLING = 'ROLLING',
  BLUE_GREEN = 'BLUE_GREEN',
  CANARY = 'CANARY',
}

export interface ReleaseManifest {
  releaseId: string;
  version: string;
  commitSha: string;
  commitShort: string;
  branch: string;
  tag?: string;
  builtAt: string;
  builtBy: string;
  environment: EnvironmentName;
  backend: {
    packageVersion: string;
    buildId: string;
    imageName: string;
    imageDigest: string;
    imageTag: string;
  };
  frontend: {
    webVersion: string;
    buildId: string;
    adminWebVersion: string;
    adminBuildId: string;
  };
  schema: {
    prismaVersion: string;
    migrationId: string;
    migrationHistory: string[];
    schemaHash: string;
  };
  artifacts: {
    sbomDigest?: string;
    signatureDigest?: string;
    artifactChecksum: string;
  };
  metadata: {
    nodeVersion: string;
    npmVersion: string;
    buildCorrelationId: string;
    buildDurationMs: number;
    reproducible: boolean;
  };
}

export interface DeploymentPlan {
  deploymentId: string;
  releaseId: string;
  correlationId: string;
  environment: EnvironmentName;
  strategy: DeploymentStrategy;
  targetServices: string[];
  migrationState: {
    currentMigrationId: string;
    targetMigrationId: string;
    pendingMigrations: string[];
    hasDestructive: boolean;
    requiresBackup: boolean;
  };
  healthGates: string[];
  approval: {
    required: boolean;
    requiredRoles: string[];
    approvedBy?: string;
    approvedAt?: string;
    approvalReference?: string;
  };
  rollback: {
    previousReleaseId: string;
    previousArtifactDigest: string;
    strategy: DeploymentStrategy;
    requiresCompatibilityCheck: boolean;
  };
  verification: {
    criteria: string[];
    timeoutMs: number;
    retryCount: number;
  };
  createdAt: string;
  createdBy: string;
}

export interface EnvironmentPolicy {
  environment: EnvironmentName;
  requiredVariables: string[];
  forbiddenVariables: string[];
  forbiddenSettings: Array<{ key: string; forbiddenValues: string[] }>;
  securityRequirements: {
    requireSecretManager: boolean;
    requireArtifactSigning: boolean;
    requireSbom: boolean;
    requireImageScan: boolean;
    requireMfaForApproval: boolean;
    minApprovalCount: number;
  };
  deployment: {
    allowedStrategies: DeploymentStrategy[];
    requiresMaintenanceWindow: boolean;
    requiresBackupBeforeMigration: boolean;
    allowDestructiveMigrations: boolean;
    maxParallelDeployments: number;
  };
  vulnerabilityPolicy: {
    blockOnCritical: boolean;
    blockOnHigh: boolean;
    allowedHighCount: number;
    allowedMediumCount: number;
    ignoreUnfixed: boolean;
  };
  backupPolicy: {
    requireRecentBackupHours: number;
    requireVerifiedBackup: boolean;
    retentionDays: number;
  };
}

export interface MigrationGateResult {
  status: MigrationGateStatus;
  currentMigrationId: string;
  targetMigrationId: string;
  pendingMigrations: string[];
  appliedMigrations: string[];
  hasDestructive: boolean;
  destructiveOperations: Array<{ migrationId: string; operation: string; table: string; details: string }>;
  historyValid: boolean;
  schemaValid: boolean;
  requiresApproval: boolean;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface RlsGateResult {
  status: RlsGateStatus;
  coveredModels: string[];
  uncoveredModels: string[];
  missingPolicies: Array<{ table: string; model: string; expectedPolicy: string }>;
  coveragePercent: number;
  totalTenantScopedModels: number;
  rlsArtifactsFound: boolean;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface ArtifactIntegrityResult {
  status: ArtifactIntegrityStatus;
  releaseId: string;
  expectedDigest: string;
  actualDigest: string;
  expectedSignature?: string;
  signatureValid?: boolean;
  manifestMatch: boolean;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface SecurityGateResult {
  status: SecurityGateStatus;
  releaseId: string;
  correlationId: string;
  dependencyScan: { status: SecurityGateStatus; vulnerabilities: VulnerabilityFinding[] };
  secretScan: { status: SecurityGateStatus; findings: number };
  imageScan: { status: SecurityGateStatus; vulnerabilities: VulnerabilityFinding[] };
  sbom: { status: SbomStatus; artifactAssociated: boolean };
  artifactIntegrity: ArtifactIntegrityResult;
  imageSecurity: ImageSecurityResult;
  overallFailureReason?: string;
  checkedAt: string;
}

export interface VulnerabilityFinding {
  id: string;
  severity: VulnerabilitySeverity;
  packageName: string;
  installedVersion: string;
  fixedVersion?: string;
  title: string;
  cvssScore?: number;
  source: string;
  isFixAvailable: boolean;
}

export interface ImageSecurityResult {
  status: ImageSecurityStatus;
  imageName: string;
  imageDigest: string;
  baseImage: string;
  baseImageAllowed: boolean;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface SbomResult {
  status: SbomStatus;
  releaseId: string;
  artifactDigest: string;
  sbomDigest: string;
  packageCount: number;
  artifactAssociated: boolean;
  generatedAt: string;
  correlationId: string;
}

export interface BackupMetadata {
  backupId: string;
  environment: EnvironmentName;
  type: 'DATABASE' | 'OBJECT_STORAGE' | 'CONFIGURATION';
  status: BackupStatus;
  createdAt: string;
  completedAt?: string;
  sizeBytes?: number;
  location: string;
  checksum: string;
  retentionUntil: string;
  verifiedAt?: string;
  verificationStatus?: BackupStatus;
  correlationId: string;
  createdBy: string;
}

export interface BackupVerificationResult {
  backupId: string;
  status: BackupStatus;
  exists: boolean;
  readable: boolean;
  checksumValid: boolean;
  recentEnough: boolean;
  ageHours: number;
  sizeBytes?: number;
  meetsPolicy: boolean;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface RestoreVerificationResult {
  restoreId: string;
  backupId: string;
  status: RestoreStatus;
  targetEnvironment: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  schemaVerified: boolean;
  migrationsVerified: boolean;
  criticalTablesVerified: boolean;
  indexesVerified: boolean;
  foreignKeysVerified: boolean;
  connectivityVerified: boolean;
  tablesChecked: string[];
  missingTables: string[];
  missingIndexes: Array<{ table: string; index: string }>;
  missingForeignKeys: Array<{ table: string; fk: string }>;
  failureReason?: string;
  checkedAt: string;
  correlationId: string;
}

export interface DisasterRecoveryResult {
  drId: string;
  environment: EnvironmentName;
  status: DisasterRecoveryStatus;
  rpoMinutes: number;
  rtoMinutes: number;
  backupAgeMinutes: number;
  restoreDurationMinutes: number;
  recoverySequence: Array<{ step: string; status: string; durationMs: number; evidence: string }>;
  dependenciesRecovered: string[];
  dependenciesFailed: string[];
  databaseRecovered: boolean;
  redisRecovered: boolean;
  queueRecovered: boolean;
  objectStorageRecovered: boolean;
  applicationHealthy: boolean;
  postRecoveryHealthPassed: boolean;
  failureReason?: string;
  measuredAt: string;
  correlationId: string;
}

export interface DeploymentVerificationResult {
  deploymentId: string;
  releaseId: string;
  correlationId: string;
  environment: EnvironmentName;
  status: DeploymentStatus;
  healthChecks: Array<{ name: string; status: string; latencyMs: number; evidence: string; checkedAt: string }>;
  apiChecks: Array<{ endpoint: string; status: string; statusCode: number; latencyMs: number }>;
  databaseCheck: { status: string; latencyMs: number; migrationId: string; verified: boolean };
  redisCheck: { status: string; latencyMs: number; verified: boolean };
  queueCheck: { status: string; depth: number; failed: number; verified: boolean };
  authCheck: { status: string; verified: boolean };
  frontendCheck: { status: string; verified: boolean };
  criticalPathVerified: boolean;
  overallPassed: boolean;
  failureReason?: string;
  verifiedAt: string;
}

export interface RollbackResult {
  rollbackId: string;
  deploymentId: string;
  fromReleaseId: string;
  toReleaseId: string;
  correlationId: string;
  environment: EnvironmentName;
  status: RollbackStatus;
  artifactVerified: boolean;
  schemaCompatible: boolean;
  requiresDbRecovery: boolean;
  executedAt?: string;
  completedAt?: string;
  healthPassed?: boolean;
  failureReason?: string;
  approvedBy?: string;
  reason: string;
}

export interface ProductionReadinessResult {
  readinessId: string;
  environment: EnvironmentName;
  status: ProductionReadinessStatus;
  correlationId: string;
  checks: {
    deployment: { status: string; passed: boolean; details: string };
    database: { status: string; passed: boolean; details: string };
    migrations: { status: string; passed: boolean; details: string };
    rls: { status: string; passed: boolean; details: string };
    security: { status: string; passed: boolean; details: string };
    backup: { status: string; passed: boolean; details: string };
    disasterRecovery: { status: string; passed: boolean; details: string };
    dependencies: { status: string; passed: boolean; details: string };
    observability: { status: string; passed: boolean; details: string };
    applicationHealth: { status: string; passed: boolean; details: string };
    releaseGates: { status: string; passed: boolean; details: string };
  };
  overallPassed: boolean;
  failureReasons: string[];
  assessedAt: string;
}

export interface DeploymentAuditEvent {
  auditId: string;
  releaseId: string;
  deploymentId?: string;
  rollbackId?: string;
  backupId?: string;
  restoreId?: string;
  drId?: string;
  environment: EnvironmentName;
  action: 'RELEASE_CREATED' | 'SECURITY_GATE' | 'MIGRATION_GATE' | 'RLS_GATE' | 'PREFLIGHT' | 'DEPLOYMENT_PLAN' | 'DEPLOYMENT_START' | 'DEPLOYMENT_APPROVAL' | 'DEPLOYMENT_EXECUTION' | 'DEPLOYMENT_VERIFICATION' | 'ROLLBACK' | 'BACKUP' | 'BACKUP_VERIFICATION' | 'RESTORE_VERIFICATION' | 'DISASTER_RECOVERY' | 'PRODUCTION_READINESS' | 'MAINTENANCE_INTEGRATION';
  result: string;
  operatorId: string;
  operatorType: 'USER' | 'CI' | 'SYSTEM';
  commitSha: string;
  artifactDigest?: string;
  migrationId?: string;
  startAt: string;
  finishAt?: string;
  durationMs?: number;
  failureReason?: string;
  approvalReference?: string;
  correlationId: string;
  evidence: Record<string, unknown>;
}

export const RELEASE_TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  [ReleaseStatus.CREATED]: [ReleaseStatus.BUILDING],
  [ReleaseStatus.BUILDING]: [ReleaseStatus.BUILT, ReleaseStatus.FAILED],
  [ReleaseStatus.BUILT]: [ReleaseStatus.SECURITY_GATES_RUNNING],
  [ReleaseStatus.SECURITY_GATES_RUNNING]: [ReleaseStatus.SECURITY_GATES_PASSED, ReleaseStatus.SECURITY_GATES_FAILED],
  [ReleaseStatus.SECURITY_GATES_FAILED]: [ReleaseStatus.FAILED],
  [ReleaseStatus.SECURITY_GATES_PASSED]: [ReleaseStatus.MANIFEST_CREATED],
  [ReleaseStatus.MANIFEST_CREATED]: [ReleaseStatus.ARTIFACT_SIGNED],
  [ReleaseStatus.ARTIFACT_SIGNED]: [ReleaseStatus.PENDING_APPROVAL],
  [ReleaseStatus.PENDING_APPROVAL]: [ReleaseStatus.APPROVED, ReleaseStatus.REJECTED],
  [ReleaseStatus.APPROVED]: [ReleaseStatus.DEPLOYING],
  [ReleaseStatus.REJECTED]: [ReleaseStatus.FAILED],
  [ReleaseStatus.DEPLOYING]: [ReleaseStatus.DEPLOYED, ReleaseStatus.FAILED],
  [ReleaseStatus.DEPLOYED]: [ReleaseStatus.VERIFYING],
  [ReleaseStatus.VERIFYING]: [ReleaseStatus.VERIFIED, ReleaseStatus.FAILED],
  [ReleaseStatus.VERIFIED]: [ReleaseStatus.VERIFIED],
  [ReleaseStatus.FAILED]: [ReleaseStatus.CREATED],
  [ReleaseStatus.ROLLED_BACK]: [ReleaseStatus.CREATED],
};

export const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  [DeploymentStatus.PLANNED]: [DeploymentStatus.PREFLIGHT_RUNNING],
  [DeploymentStatus.PREFLIGHT_RUNNING]: [DeploymentStatus.PREFLIGHT_PASSED, DeploymentStatus.PREFLIGHT_FAILED],
  [DeploymentStatus.PREFLIGHT_FAILED]: [DeploymentStatus.FAILED],
  [DeploymentStatus.PREFLIGHT_PASSED]: [DeploymentStatus.MIGRATION_GATE_RUNNING],
  [DeploymentStatus.MIGRATION_GATE_RUNNING]: [DeploymentStatus.MIGRATION_GATE_PASSED, DeploymentStatus.MIGRATION_GATE_FAILED],
  [DeploymentStatus.MIGRATION_GATE_FAILED]: [DeploymentStatus.FAILED],
  [DeploymentStatus.MIGRATION_GATE_PASSED]: [DeploymentStatus.RLS_GATE_RUNNING],
  [DeploymentStatus.RLS_GATE_RUNNING]: [DeploymentStatus.RLS_GATE_PASSED, DeploymentStatus.RLS_GATE_FAILED],
  [DeploymentStatus.RLS_GATE_FAILED]: [DeploymentStatus.FAILED],
  [DeploymentStatus.RLS_GATE_PASSED]: [DeploymentStatus.SECURITY_GATE_RUNNING],
  [DeploymentStatus.SECURITY_GATE_RUNNING]: [DeploymentStatus.SECURITY_GATE_PASSED, DeploymentStatus.SECURITY_GATE_FAILED],
  [DeploymentStatus.SECURITY_GATE_FAILED]: [DeploymentStatus.FAILED],
  [DeploymentStatus.SECURITY_GATE_PASSED]: [DeploymentStatus.AWAITING_APPROVAL],
  [DeploymentStatus.AWAITING_APPROVAL]: [DeploymentStatus.APPROVED, DeploymentStatus.FAILED],
  [DeploymentStatus.APPROVED]: [DeploymentStatus.EXECUTING],
  [DeploymentStatus.EXECUTING]: [DeploymentStatus.EXECUTED, DeploymentStatus.FAILED],
  [DeploymentStatus.EXECUTED]: [DeploymentStatus.VERIFYING],
  [DeploymentStatus.VERIFYING]: [DeploymentStatus.VERIFIED, DeploymentStatus.FAILED],
  [DeploymentStatus.VERIFIED]: [DeploymentStatus.VERIFIED],
  [DeploymentStatus.FAILED]: [DeploymentStatus.PLANNED],
  [DeploymentStatus.ROLLED_BACK]: [DeploymentStatus.PLANNED],
};

export const CRITICAL_TABLES_FOR_RESTORE = [
  'Tenant',
  'User',
  'Subscription',
  'Payment',
  'Invoice',
  'KycProfile',
  'ExchangeAccount',
  'CopySubscription',
  'RiskConfiguration',
  'Order',
  'Position',
  'PortfolioSnapshot',
  'ClientRelationship',
  'CustodyWallet',
  'CustodyWithdrawal',
  'AuditLog',
  'SecurityEvent',
  'ComplianceCase',
  'BillingPlan',
  'TenantDomain',
] as const;

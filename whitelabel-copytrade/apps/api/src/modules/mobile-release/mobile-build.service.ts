import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileEnvReader, MOBILE_RELEASE_ENV, MobileReleasePolicyService } from './mobile-release-policy.service';
import {
  APPLICATION_TRANSITIONS,
  AUDIT_ACTIONS,
  BUILD_TRANSITIONS,
  idempotencyKey,
  transitionOrThrow,
  MobileActor,
  MobileApplicationState,
  MobileBuildState,
  MobileEnvironment,
  MobilePlatform,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
} from './mobile-release.types';
import {
  BuildRequestShape,
  MobileBuildValidationService,
} from './mobile-build-validation.service';

/**
 * The build runner port. The default implementation reports unavailability —
 * a build "command" this platform cannot actually run must never be dressed
 * up as success. Deployments with real infrastructure (CI agents, macOS
 * signing hosts) provide an adapter that returns the produced artifact path.
 */
export interface MobileBuildRunnerResult {
  artifactPath: string;
  toolchainVersion: string;
  buildLogTail: string;
}

/** DI token so Nest can wire a real runner; absent -> default CLI runner. */
export const MOBILE_BUILD_RUNNER = Symbol('MOBILE_BUILD_RUNNER');

export interface MobileBuildRunner {
  readonly name: string;
  isAvailable(platform: MobilePlatform, flutterRoot: string): boolean;
  run(input: {
    platform: MobilePlatform;
    buildMode: string;
    flutterRoot: string;
    androidPackageId: string | null;
    iosBundleId: string | null;
    versionName: string;
    versionCode: number;
    logPath: string;
  }): Promise<MobileBuildRunnerResult>;
}

/**
 * Honest default: the platform ships without build agents. `isAvailable`
 * checks for the Flutter SDK the same way the validation service does, and
 * `run` executes the real flutter build command for ANDROID when the SDK is
 * present. iOS requires a macOS host; without one the availability check
 * fails and the caller sees BUILD_UNAVAILABLE — never a fabricated ipa.
 */
@Injectable()
export class FlutterCliBuildRunner implements MobileBuildRunner {
  readonly name = 'flutter-cli';

  private flutterBin(): string | null {
    const explicit = process.env.FLUTTER_BIN;
    if (explicit && existsSync(explicit)) return explicit;
    const wellKnown = '/usr/local/bin/flutter';
    if (existsSync(wellKnown)) return wellKnown;
    return null;
  }

  isAvailable(platform: MobilePlatform, flutterRoot: string): boolean {
    if (!existsSync(join(flutterRoot, 'pubspec.yaml'))) return false;
    if (!this.flutterBin()) return false;
    if (platform === 'IOS' && process.platform !== 'darwin') return false;
    return true;
  }

  async run(input: {
    platform: MobilePlatform;
    buildMode: string;
    flutterRoot: string;
    androidPackageId: string | null;
    iosBundleId: string | null;
    versionName: string;
    versionCode: number;
    logPath: string;
  }): Promise<MobileBuildRunnerResult> {
    const bin = this.flutterBin();
    if (!bin) throw new Error('flutter SDK not found');
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const args =
      input.platform === 'ANDROID'
        ? ['build', input.buildMode === 'debug' ? 'apk' : 'appbundle', '--no-pub']
        : ['build', 'ipa', '--no-pub', '--export-method', 'ad-hoc'];
    args.push('--build-name', input.versionName, '--build-number', String(input.versionCode));

    let stdout = '';
    try {
      stdout = execFileSync(bin, args, {
        cwd: input.flutterRoot,
        encoding: 'utf8',
        timeout: 45 * 60_000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        mkdirSync(join(input.logPath, '..'), { recursive: true });
        writeFileSync(input.logPath, `flutter build failed:\n${detail}`, 'utf8');
      } catch {
        // log persistence is best-effort; the failure itself is already durable
      }
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `flutter build failed: ${detail.slice(0, 200)}`,
        500,
      );
    }
    try {
      mkdirSync(join(input.logPath, '..'), { recursive: true });
      writeFileSync(input.logPath, stdout.slice(-200_000), 'utf8');
    } catch {
      // best-effort log persistence
    }

    const artifactPath =
      input.platform === 'ANDROID'
        ? join(
            input.flutterRoot,
            'build',
            'app',
            'outputs',
            input.buildMode === 'debug' ? 'apk' : 'bundle',
            input.buildMode === 'debug' ? 'app-debug.apk' : 'release',
            input.buildMode === 'debug' ? 'app-debug.apk' : 'app-release.aab',
          )
        : join(input.flutterRoot, 'build', 'ios', 'ipa');

    if (!existsSync(artifactPath)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `flutter build produced no artifact at ${artifactPath}`,
        500,
      );
    }
    const machine = require('child_process').execFileSync(bin, ['--version', '--machine'], {
      encoding: 'utf8',
    });
    let toolchain = 'unknown';
    try {
      toolchain = JSON.parse(machine).flutterVersion ?? 'unknown';
    } catch {
      toolchain = machine.slice(0, 64);
    }
    return { artifactPath, toolchainVersion: toolchain, buildLogTail: stdout.slice(-4000) };
  }
}

export interface CreateBuildInput {
  applicationId: string;
  tenantId: string;
  platform: MobilePlatform;
  environment: MobileEnvironment;
  buildMode: string;
  versionName: string;
  versionCode: number;
  iosBuildNumber?: number | null;
  commitSha?: string | null;
  actor: MobileActor;
  correlationId: string;
}

/**
 * The build orchestrator: idempotent request -> validation -> queueing ->
 * real runner execution -> state machine transitions -> artifact hand-off.
 * A build that cannot run (no SDK, no agent) records FAILED with the
 * BUILD_UNAVAILABLE code — the honest state — and can never reach VERIFIED.
 */
@Injectable()
export class MobileBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: MobileBuildValidationService,
    private readonly policy: MobileReleasePolicyService,
    @Optional()
    @Inject(MOBILE_BUILD_RUNNER)
    private readonly runner: MobileBuildRunner = new FlutterCliBuildRunner(),
    @Inject(MOBILE_RELEASE_ENV) private readonly env: MobileEnvReader = { get: () => undefined },
  ) {}

  private buildRoot(): string {
    const root = this.env.get('MOBILE_BUILD_ARTIFACT_ROOT');
    return root && root.length > 0 ? root : '/tmp/wlct-mobile-artifacts';
  }

  /**
   * Creates (or idempotently replays) a build request. The idempotency key is
   * a deterministic hash of every identity-bearing field, so the same commit
   * + version + platform + environment replays the same build row instead of
   * minting a second one.
   */
  /** Tenant-scoped, read-only build listing (customer-visible projection). */
  async listBuilds(
    tenantId: string,
    q: { applicationId?: string; platform?: string; environment?: string; state?: string; page: number; pageSize: number },
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const where: Record<string, unknown> = { tenantId };
    if (q.applicationId) where.applicationId = q.applicationId;
    if (q.platform) where.platform = q.platform;
    if (q.environment) where.environment = q.environment;
    if (q.state) where.state = q.state;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mobileBuild.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.mobileBuild.count({ where }),
    ]);
    return { items: items as unknown as Array<Record<string, unknown>>, total };
  }

  async requestBuild(input: CreateBuildInput): Promise<{
    build: Record<string, unknown>;
    replayed: boolean;
  }> {
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: input.applicationId, tenantId: input.tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.APP_NOT_FOUND,
        'mobile application not found for this tenant',
        404,
        { applicationId: input.applicationId },
      );
    }
    const buildableStates: MobileApplicationState[] = [
      'CONFIGURED',
      'READY_FOR_BUILD',
      'BUILD_FAILED',
      'BUILT',
      'SIGNED',
      'READY_FOR_RELEASE',
      'ACTIVE',
    ];
    if (!buildableStates.includes(app.state as MobileApplicationState)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.APP_STATE,
        `application in state ${app.state} cannot request builds`,
        409,
        { state: app.state },
      );
    }

    // Daily build budget per app (policy), counted from QUEUED+ rows today.
    const day = this.policy.buildBudgetDay();
    const todays = await this.prisma.mobileBuild.count({
      where: { applicationId: app.id, createdAt: { gte: new Date(`${day}T00:00:00.000Z`) } },
    });
    const budget = this.policy.resolve().maxBuildsPerAppPerDay;
    const key = idempotencyKey(
      'build',
      app.id,
      input.platform,
      input.environment,
      input.buildMode,
      input.versionName,
      input.versionCode,
      input.commitSha ?? '',
    );

    const existing = await this.prisma.mobileBuild.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { build: existing as unknown as Record<string, unknown>, replayed: true };

    if (todays >= budget) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `daily build budget exhausted (${budget}/day) for this app`,
        429,
        { budget, used: todays },
      );
    }

    const build = await this.prisma.mobileBuild.create({
      data: {
        applicationId: app.id,
        tenantId: input.tenantId,
        platform: input.platform,
        environment: input.environment,
        buildMode: input.buildMode,
        state: 'QUEUED',
        versionName: input.versionName,
        versionCode: input.versionCode,
        iosBuildNumber: input.iosBuildNumber ?? (input.platform === 'IOS' ? input.versionCode : null),
        commitSha: input.commitSha ?? null,
        idempotencyKey: key,
        requestedById: input.actor.userId,
      },
    });
    return { build: build as unknown as Record<string, unknown>, replayed: false };
  }

  /**
   * Validates, then actually runs the build. Every state change goes through
   * the transition map; a validation failure moves QUEUED->FAILED with the
   * finding codes attached, and a missing runner moves it to FAILED with
   * failureCode=BUILD_UNAVAILABLE. Neither can ever become VERIFIED.
   */
  async runBuild(buildId: string, tenantId: string): Promise<Record<string, unknown>> {
    const build = await this.mustGet(buildId, tenantId);
    if (build.state !== 'QUEUED') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `build ${buildId} is ${build.state}; only QUEUED builds can run`,
        409,
        { state: build.state },
      );
    }
    const app = await this.prisma.mobileApplication.findUnique({ where: { id: build.applicationId } });
    if (!app) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'application vanished', 404);
    }

    const request: BuildRequestShape = {
      platform: build.platform as MobilePlatform,
      environment: build.environment as MobileEnvironment,
      buildMode: build.buildMode,
      versionName: build.versionName,
      versionCode: build.versionCode,
      iosBuildNumber: build.iosBuildNumber,
      commitSha: build.commitSha,
    };

    let state: MobileBuildState = transition(build.state as MobileBuildState, 'VALIDATING');
    await this.prisma.mobileBuild.update({ where: { id: build.id }, data: { state } });

    const validation = this.validation.validate(request);
    if (!validation.valid) {
      return this.fail(build.id, 'BUILD_VALIDATION_FAILED', validation.findings.map((f) => `${f.code}: ${f.detail}`).join('; ').slice(0, 500));
    }

    if (!validation.flutterRoot) {
      return this.fail(build.id, 'BUILD_UNAVAILABLE', 'no flutter project available to build');
    }
    if (!this.runner.isAvailable(request.platform, validation.flutterRoot)) {
      return this.fail(
        build.id,
        'BUILD_UNAVAILABLE',
        `no build agent available for ${request.platform}; install the ${request.platform === 'IOS' ? 'macOS/Xcode' : 'Android SDK + Flutter'} toolchain and set FLUTTER_BIN`,
      );
    }

    state = transition(state, 'BUILDING');
    await this.prisma.mobileBuild.update({
      where: { id: build.id },
      data: { state, startedAt: new Date() },
    });

    const logDir = join(this.buildRoot(), build.tenantId, build.id);
    let result;
    try {
      result = await this.runner.run({
        platform: request.platform,
        buildMode: request.buildMode,
        flutterRoot: validation.flutterRoot,
        androidPackageId: app.androidPackageId,
        iosBundleId: app.iosBundleId,
        versionName: request.versionName,
        versionCode: request.versionCode,
        logPath: join(logDir, 'build.log'),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.fail(build.id, detail.includes('flutter build failed') ? 'BUILD_FAILED' : 'BUILD_UNAVAILABLE', detail.slice(0, 500));
    }

    state = transition(state, 'BUILT');
    const updated = await this.prisma.mobileBuild.update({
      where: { id: build.id },
      data: {
        state,
        toolchainVersion: result.toolchainVersion,
        logReference: join(logDir, 'build.log'),
        runnerReference: this.runner.name,
        finishedAt: new Date(),
      },
    });

    // Application lifecycle mirrors the build outcome.
    await this.prisma.mobileApplication.update({
      where: { id: app.id },
      data: {
        state: transitionOrThrow(
          APPLICATION_TRANSITIONS,
          app.state as MobileApplicationState,
          'BUILT',
          'application',
        ),
      },
    });
    return updated as unknown as Record<string, unknown>;

    function transition(from: MobileBuildState, to: MobileBuildState): MobileBuildState {
      const allowed = BUILD_TRANSITIONS[from] ?? [];
      if (!allowed.includes(to)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.ILLEGAL_TRANSITION,
          `build ${from} -> ${to} is illegal`,
          409,
        );
      }
      return to;
    }
  }

  /** Records an honest failure (terminal state) with a stable failure code. */
  private async fail(buildId: string, code: string, detail: string): Promise<Record<string, unknown>> {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!build) throw new MobileReleaseError(MOBILE_ERROR_CODES.BUILD_NOT_FOUND, 'build vanished', 404);
    // FAILED is a legal terminal only from mapped states; validate the edge.
    const state = transitionOrThrow(
      BUILD_TRANSITIONS,
      build.state as MobileBuildState,
      'FAILED',
      'build',
    );
    const updated = await this.prisma.mobileBuild.update({
      where: { id: build.id },
      data: { state, failureCode: code, failureDetail: detail, finishedAt: new Date() },
    });
    // If the app lifecycle is parked in BUILDING for this failed build, mirror
    // the honest failure state. (The guard uses state guard rails so a build
    // that was never started does not clobber an app mid-different-build.)
    if (build.state === 'BUILDING') {
      await this.prisma.mobileApplication.updateMany({
        where: { id: build.applicationId, state: 'BUILDING' },
        data: { state: 'BUILD_FAILED' },
      });
    }
    return updated as unknown as Record<string, unknown>;
  }

  /** Marks a finished build VERIFIED (verification service is the only caller). */
  async markVerified(buildId: string): Promise<void> {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!build) throw new MobileReleaseError(MOBILE_ERROR_CODES.BUILD_NOT_FOUND, 'build vanished', 404);
    transitionOrThrow(BUILD_TRANSITIONS, build.state as MobileBuildState, 'VERIFIED', 'build');
    await this.prisma.mobileBuild.update({ where: { id: buildId }, data: { state: 'VERIFIED' } });
  }

  /** Marks a build REJECTED with reason (verification/scan gate failures). */
  async markRejected(buildId: string, reason: string): Promise<void> {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!build) throw new MobileReleaseError(MOBILE_ERROR_CODES.BUILD_NOT_FOUND, 'build vanished', 404);
    transitionOrThrow(BUILD_TRANSITIONS, build.state as MobileBuildState, 'REJECTED', 'build');
    await this.prisma.mobileBuild.update({
      where: { id: buildId },
      data: { state: 'REJECTED', failureCode: 'REJECTED_BY_GATE', failureDetail: reason.slice(0, 500) },
    });
  }

  async mustGet(buildId: string, tenantId: string) {
    const build = await this.prisma.mobileBuild.findFirst({ where: { id: buildId, tenantId } });
    if (!build) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_NOT_FOUND,
        'build not found for this tenant',
        404,
        { buildId },
      );
    }
    return build;
  }

  /** Deterministic sha256 fingerprint of the build's configuration identity. */
  buildIdentityFingerprint(build: {
    applicationId: string;
    platform: string;
    environment: string;
    buildMode: string;
    versionName: string;
    versionCode: number;
    commitSha: string | null;
    toolchainVersion: string | null;
  }): string {
    return createHash('sha256')
      .update(
        [
          build.applicationId,
          build.platform,
          build.environment,
          build.buildMode,
          build.versionName,
          build.versionCode,
          build.commitSha ?? '',
          build.toolchainVersion ?? '',
        ].join('|'),
      )
      .digest('hex');
  }
}

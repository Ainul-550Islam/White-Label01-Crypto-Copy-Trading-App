import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import type { MobileEnvironment, MobilePlatform } from './mobile-release.types';
import { MobileReleaseError, MOBILE_ERROR_CODES } from './mobile-release.types';

/**
 * Pre-flight validation for a mobile build request, against the REAL Flutter
 * project on disk. Every check reads actual files — a missing pubspec.lock or
 * an absent android/ gradle file fails here, before any build runner runs.
 *
 * The Flutter root is resolved once: MOBILE_FLUTTER_ROOT wins, then the
 * process cwd and its ancestors are searched for apps/mobile/pubspec.yaml so
 * both `npm run start:dev` (cwd = apps/api) and repo-root invocations work.
 */

export interface BuildRequestShape {
  platform: MobilePlatform;
  environment: MobileEnvironment;
  buildMode: string;
  versionName: string;
  versionCode: number;
  iosBuildNumber?: number | null;
  commitSha?: string | null;
}

export interface ValidationFinding {
  code: string;
  detail: string;
}

export interface BuildValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
  flutterRoot: string | null;
  pubspecVersion: string | null;
  pubspecLockSha256: string | null;
}

const VERSION_RX = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;
const COMMIT_RX = /^[0-9a-f]{40}$/;

@Injectable()
export class MobileBuildValidationService {
  /** Locates the Flutter project; null when absent (reported, never assumed). */
  resolveFlutterRoot(explicit?: string | null): string | null {
    if (explicit) {
      const p = isAbsolute(explicit) ? explicit : resolve(explicit);
      return existsSync(join(p, 'pubspec.yaml')) ? p : null;
    }
    const fromEnv = process.env.MOBILE_FLUTTER_ROOT;
    if (fromEnv) return this.resolveFlutterRoot(fromEnv);
    let dir = process.cwd();
    for (let i = 0; i < 7; i++) {
      const candidate = join(dir, 'apps', 'mobile');
      if (existsSync(join(candidate, 'pubspec.yaml'))) return candidate;
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Full pre-flight. Collects ALL findings (an operator fixes five things in
   * one pass, not five round-trips) and returns them; `valid` is false when
   * any finding exists. Throws only for structurally impossible requests
   * (bad version grammar) so callers get typed errors, not finding lists.
   */
  validate(
    request: BuildRequestShape,
    flutterRootOverride?: string | null,
  ): BuildValidationResult {
    const findings: ValidationFinding[] = [];

    if (!VERSION_RX.test(request.versionName)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `versionName ${request.versionName} is not X.Y.Z semantic versioning`,
        400,
        { versionName: request.versionName },
      );
    }
    if (!Number.isInteger(request.versionCode) || request.versionCode <= 0) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        'versionCode must be a positive integer',
        400,
      );
    }
    if (request.platform === 'IOS' && (request.iosBuildNumber ?? 0) <= 0) {
      findings.push({
        code: 'IOS_BUILD_NUMBER_REQUIRED',
        detail: 'iOS builds require a positive iosBuildNumber',
      });
    }
    if (request.commitSha && !COMMIT_RX.test(request.commitSha)) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        'commitSha must be a 40-character hex SHA',
        400,
      );
    }
    if (request.buildMode !== 'debug' && request.buildMode !== 'release') {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.BUILD_VALIDATION,
        `buildMode must be debug or release, got ${request.buildMode}`,
        400,
      );
    }
    // Production always builds in release mode; a debug production binary is
    // a signing and telemetry hazard, not a preference.
    if (request.environment === 'PRODUCTION' && request.buildMode !== 'release') {
      findings.push({
        code: 'PRODUCTION_REQUIRES_RELEASE_MODE',
        detail: 'production builds must use buildMode=release',
      });
    }

    const flutterRoot = this.resolveFlutterRoot(flutterRootOverride);
    if (!flutterRoot) {
      findings.push({
        code: 'FLUTTER_ROOT_MISSING',
        detail: 'no apps/mobile project (pubspec.yaml) found; set MOBILE_FLUTTER_ROOT',
      });
      return { valid: false, findings, flutterRoot: null, pubspecVersion: null, pubspecLockSha256: null };
    }

    // Platform scaffolding must actually exist.
    const gradlePath = join(flutterRoot, 'android', 'app', 'build.gradle');
    if (existsSync(gradlePath)) {
      const gradle = readFileSync(gradlePath, 'utf8');
      if (!/applicationId\s+/.test(gradle)) {
        findings.push({
          code: 'ANDROID_APPLICATION_ID_MISSING',
          detail: 'android/app/build.gradle declares no applicationId',
        });
      }
    } else {
      findings.push({ code: 'ANDROID_PROJECT_MISSING', detail: 'android/app/build.gradle not found' });
    }

    const infoPlistPath = join(flutterRoot, 'ios', 'Runner', 'Info.plist');
    if (!existsSync(infoPlistPath)) {
      findings.push({ code: 'IOS_PROJECT_MISSING', detail: 'ios/Runner/Info.plist not found' });
    }

    // Version metadata: pubspec version is the source the toolchain stamps;
    // a mismatch with the requested version ships the wrong binary identity.
    const pubspec = readFileSync(join(flutterRoot, 'pubspec.yaml'), 'utf8');
    const versionLine = /^version:\s*(\d+\.\d+\.\d+(?:[-+][^\s#]+)?)/m.exec(pubspec);
    const pubspecVersion = versionLine ? versionLine[1].split('+')[0] : null;
    if (!pubspecVersion) {
      findings.push({ code: 'PUBSPEC_VERSION_MISSING', detail: 'pubspec.yaml has no version:' });
    } else if (pubspecVersion !== request.versionName) {
      findings.push({
        code: 'VERSION_MISMATCH',
        detail: `pubspec version ${pubspecVersion} != requested ${request.versionName}`,
      });
    }

    // Dependency lock state: pubspec.lock must exist and mention every
    // direct dependency section, else builds are not reproducible.
    const lockPath = join(flutterRoot, 'pubspec.lock');
    let pubspecLockSha256: string | null = null;
    if (existsSync(lockPath)) {
      const lock = readFileSync(lockPath, 'utf8');
      pubspecLockSha256 = createHash('sha256').update(lock).digest('hex');
      const sdks = /^sdks:/m.test(lock);
      const packages = /^packages:/m.test(lock);
      if (!sdks || !packages) {
        findings.push({
          code: 'PUBSPEC_LOCK_INCOMPLETE',
          detail: 'pubspec.lock lacks packages:/sdks: sections; run flutter pub get',
        });
      }
    } else {
      findings.push({
        code: 'PUBSPEC_LOCK_MISSING',
        detail: 'pubspec.lock not found; dependency versions are unpinned',
      });
    }

    // Generated assets that white-label branding requires at build time.
    for (const required of [
      join(flutterRoot, 'android', 'app', 'src', 'main', 'res'),
      join(flutterRoot, 'ios', 'Runner', 'Assets.xcassets'),
    ]) {
      if (!existsSync(required)) {
        findings.push({
          code: 'ASSETS_MISSING',
          detail: `required platform asset directory missing: ${required}`,
        });
      }
    }

    return {
      valid: findings.length === 0,
      findings,
      flutterRoot,
      pubspecVersion,
      pubspecLockSha256,
    };
  }

  /** Toolchain version string (flutter --version) or null when unavailable. */
  toolchainVersion(flutterRoot: string | null): { version: string | null; available: boolean } {
    if (!flutterRoot || !existsSync(join(flutterRoot, 'pubspec.yaml'))) {
      return { version: null, available: false };
    }
    const flutterBin =
      process.env.FLUTTER_BIN ||
      (existsSync('/usr/local/bin/flutter') ? '/usr/local/bin/flutter' : null);
    if (!flutterBin) {
      // SDK genuinely absent — the build gate reports this, it never guesses.
      return { version: null, available: false };
    }
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const out = execFileSync(flutterBin, ['--version', '--machine'], {
        timeout: 30_000,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(out) as { flutterVersion?: string; version?: string };
      const version = parsed.flutterVersion ?? parsed.version ?? null;
      return { version, available: Boolean(version) };
    } catch {
      return { version: null, available: false };
    }
  }

  /** true when the path exists and is a regular file (artifact presence). */
  fileExists(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }
}

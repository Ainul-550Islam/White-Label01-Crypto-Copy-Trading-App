import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

export interface BuildInfo {
  name: string;
  version: string;
  environment: string;
  commit: string;
  startedAt: string;
  uptimeSeconds: number;
  nodeVersion: string;
}

/**
 * Static build/runtime facts shared by the health endpoints.
 *
 * Nothing here is sensitive: no connection strings, no secrets, no hostnames
 * beyond what the load balancer already knows.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = new Date();

  constructor(private readonly config: AppConfigService) {}

  getBuildInfo(): BuildInfo {
    return {
      name: this.config.appName,
      version: process.env.APP_VERSION ?? this.config.swaggerVersion,
      environment: this.config.nodeEnv,
      commit: process.env.GIT_COMMIT_SHA ?? 'unknown',
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
    };
  }

  getMemoryUsage(): Record<string, number> {
    const usage = process.memoryUsage();
    return {
      rssMb: Math.round(usage.rss / 1024 / 1024),
      heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),
      externalMb: Math.round(usage.external / 1024 / 1024),
    };
  }
}

// # Responsibility: binds the login-anomaly ports to Postgres, reading only keyed hashes and counting failures from the existing attempts table.
//
// The anomaly service decides WHAT is anomalous; this file decides where the facts
// come from. Two rules keep the two apart:
//
//   * Devices are read from `login_devices`, which stores one keyed hash per
//     (tenant, user, device). No raw fingerprint, address or agent is written
//     there, so a reader of this table learns which accounts exist and when they
//     were used - never from where, exactly.
//   * Failures are counted from `login_attempts`, which already exists and is
//     already written by the auth path. Re-deriving them here would give the
//     platform two answers to "how many failures" and therefore no reliable one.
import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  KnownDevice,
  LoginAnomalyRepository,
} from './login-anomaly.service';

@Injectable()
export class PrismaLoginAnomalyRepository implements LoginAnomalyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listDevices(input: { tenantId: string; userId: string }): Promise<KnownDevice[]> {
    const rows = await this.prisma.withTenantRls(input.tenantId, (tx) => tx.loginDevice.findMany({
      where: { tenantId: input.tenantId, userId: input.userId },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    }));
    return rows.map((row) => ({
      fingerprintHash: row.fingerprintHash,
      countryCode: row.countryCode,
      // Prisma returns Decimal for the coordinate columns; the service only needs
      // numbers, and null stays null - a device with no recorded position must not
      // be treated as being at 0,0.
      lastLatitude: row.lastLatitude === null ? null : Number(row.lastLatitude),
      lastLongitude: row.lastLongitude === null ? null : Number(row.lastLongitude),
      lastSeenAt: row.lastSeenAt,
      trusted: row.trusted,
    }));
  }

  async countRecentFailures(input: { tenantId: string; userId: string; since: Date }): Promise<number> {
    return this.prisma.withTenantRls(input.tenantId, (tx) => tx.loginAttempt.count({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        successful: false,
        createdAt: { gte: input.since },
      },
    }));
  }

  async upsertDevice(input: {
    tenantId: string;
    userId: string;
    fingerprintHash: string;
    countryCode: string | null;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastSeenAt: Date;
    trusted: boolean;
  }): Promise<void> {
    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: input.tenantId }, select: { id: true } });
      if (!user) throw new NotFoundException('User not found');
      await tx.loginDevice.upsert({
        where: {
          tenantId_userId_fingerprintHash: {
            tenantId: input.tenantId,
            userId: input.userId,
            fingerprintHash: input.fingerprintHash,
          },
        },
        create: {
          tenantId: input.tenantId,
          userId: input.userId,
          fingerprintHash: input.fingerprintHash,
          countryCode: input.countryCode,
          lastLatitude: input.lastLatitude,
          lastLongitude: input.lastLongitude,
          lastSeenAt: input.lastSeenAt,
          trusted: input.trusted,
        },
        update: {
          // Nulls in the input mean "not reported this time", so they must not
          // overwrite a known value: losing the last known country would make the
          // next sign-in look like a new country and produce a false alert.
          ...(input.countryCode === null ? {} : { countryCode: input.countryCode }),
          ...(input.lastLatitude === null ? {} : { lastLatitude: input.lastLatitude }),
          ...(input.lastLongitude === null ? {} : { lastLongitude: input.lastLongitude }),
          lastSeenAt: input.lastSeenAt,
          trusted: input.trusted,
        },
      });
    });
  }
}

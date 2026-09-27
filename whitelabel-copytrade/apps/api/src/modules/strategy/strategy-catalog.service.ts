import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotFoundException } from '../../common/errors/app.exception';
import {
  toStrategyDefinitionView,
  toStrategyVersionView,
  type StrategyDefinitionRow,
  type StrategyVersionRow,
} from './strategy.mapper';
import type { StrategyDefinitionView, StrategyVersionView } from './strategy.types';

/**
 * The catalogue of strategy implementations and their published versions.
 *
 * Read-only over HTTP, and that is not a temporary state. A definition
 * describes a class that ships with the release; creating one from a request
 * body would produce a catalogue entry with no code behind it, and an operator
 * would eventually try to run it. Definitions and versions are seeded from the
 * registry by the deployment, which is the only place that knows what actually
 * exists.
 *
 * The catalogue is platform-level, not tenant-scoped: the same class for every
 * tenant, holding no customer data. Tenant scoping starts at the instance.
 */
@Injectable()
export class StrategyCatalogService {
  private static readonly VERSION_SELECT = {
    id: true,
    definitionId: true,
    version: true,
    status: true,
    implementationId: true,
    parameterSchema: true,
    defaultParameters: true,
    behaviourHash: true,
    changeNote: true,
    publishedAt: true,
    deprecatedAt: true,
    createdAt: true,
  } satisfies Prisma.StrategyVersionSelect;

  private static readonly DEFINITION_SELECT = {
    id: true,
    key: true,
    displayName: true,
    description: true,
    category: true,
    isImplemented: true,
    isReserved: true,
    riskNotes: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { versions: true } },
  } satisfies Prisma.StrategyDefinitionSelect;

  private static readonly SORTABLE_FIELDS = ['key', 'displayName', 'createdAt'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(filter: {
    includeReserved?: boolean;
    category?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<StrategyDefinitionView>> {
    const pagination = normalisePagination(filter, StrategyCatalogService.SORTABLE_FIELDS);

    // Reserved entries are hidden unless asked for. They exist to stop the
    // well-known ids being taken by something that is not what an operator
    // would expect; listing them beside runnable strategies invites an attempt
    // to run one.
    const where: Prisma.StrategyDefinitionWhereInput = {
      ...(filter.includeReserved ? {} : { isReserved: false }),
      ...(filter.category ? { category: filter.category } : {}),
      ...(pagination.search
        ? {
            OR: [
              { key: { contains: pagination.search, mode: 'insensitive' } },
              { displayName: { contains: pagination.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.strategyDefinition.findMany({
        where,
        select: StrategyCatalogService.DEFINITION_SELECT,
        orderBy: { [pagination.sortBy ?? 'key']: pagination.sortBy ? pagination.sortOrder : 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.strategyDefinition.count({ where }),
    ]);

    return {
      items: rows.map((row) => toStrategyDefinitionView(row as StrategyDefinitionRow)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, total),
    };
  }

  async getDefinition(key: string): Promise<StrategyDefinitionView> {
    const row = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: {
        ...StrategyCatalogService.DEFINITION_SELECT,
        versions: {
          select: StrategyCatalogService.VERSION_SELECT,
          orderBy: { version: 'asc' },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('Strategy definition not found.');
    }

    return toStrategyDefinitionView(row as unknown as StrategyDefinitionRow);
  }

  async listVersions(key: string, filter: { status?: string }): Promise<StrategyVersionView[]> {
    const definition = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: { id: true },
    });

    if (!definition) {
      throw new NotFoundException('Strategy definition not found.');
    }

    const rows = await this.prisma.strategyVersion.findMany({
      where: {
        definitionId: definition.id,
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      select: StrategyCatalogService.VERSION_SELECT,
      orderBy: { version: 'asc' },
    });

    return rows.map((row) => toStrategyVersionView(row as StrategyVersionRow));
  }

  /**
   * Resolve a runnable version, or explain precisely why it is not runnable.
   *
   * Used by both the enable path and the backtest path. The four refusals are
   * distinct on purpose: "no such version" and "that version is a draft" send
   * an operator to entirely different places.
   */
  async resolveRunnableVersion(
    key: string,
    version: string,
  ): Promise<{
    definitionId: string;
    versionId: string;
    implementationId: string;
    parameterSchema: unknown;
    defaultParameters: unknown;
  }> {
    const definition = await this.prisma.strategyDefinition.findUnique({
      where: { key },
      select: { id: true, isImplemented: true, isReserved: true },
    });

    if (!definition) {
      throw new NotFoundException(`Strategy definition ${key} is not in the catalogue.`);
    }

    if (definition.isReserved || !definition.isImplemented) {
      throw new NotFoundException(
        `Strategy ${key} is a reserved identifier with no implementation behind it. ` +
          'It cannot be run.',
      );
    }

    const row = await this.prisma.strategyVersion.findFirst({
      where: { definitionId: definition.id, version },
      select: {
        id: true,
        status: true,
        implementationId: true,
        parameterSchema: true,
        defaultParameters: true,
      },
    });

    if (!row) {
      throw new NotFoundException(`Strategy ${key} has no version ${version}.`);
    }

    if (row.status === 'DRAFT') {
      throw new NotFoundException(
        `Version ${version} of ${key} is a draft. Publish it before running it: a draft's ` +
          'behaviour is still allowed to change, which would make any result from it ' +
          'unreproducible.',
      );
    }

    if (row.status === 'DISABLED') {
      throw new NotFoundException(`Version ${version} of ${key} is disabled.`);
    }

    return {
      definitionId: definition.id,
      versionId: row.id,
      implementationId: row.implementationId,
      parameterSchema: row.parameterSchema,
      defaultParameters: row.defaultParameters,
    };
  }
}

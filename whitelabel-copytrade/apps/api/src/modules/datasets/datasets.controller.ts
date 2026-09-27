import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@wlct/shared-types';
import type { AuthenticatedActor, PaginatedResult } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { DatasetIngestionService } from './dataset-ingestion.service';
import { DatasetLifecycleService } from './dataset-lifecycle.service';
import { DatasetRegistryService } from './dataset-registry.service';
import {
  ArchiveDatasetVersionDto,
  ListDatasetFilesDto,
  ListDatasetVersionsDto,
  ListDatasetsDto,
  ListIngestionRunsDto,
  QuarantineDatasetVersionDto,
  RecordDatasetValidationDto,
  RegisterDatasetVersionDto,
  ReplayRangesQueryDto,
  RequestDatasetIngestionDto,
  RequestDatasetValidationDto,
} from './dto/datasets.dto';
import type {
  DatasetCommandAcceptedView,
  DatasetFileView,
  DatasetValidationView,
  DatasetVersionView,
  DatasetView,
  IngestionRunView,
  ReplayRangeView,
} from './datasets.types';

/**
 * The historical dataset registry: what exists, whether it is valid, and how
 * to get more of it.
 *
 * What this controller does not have, and never will:
 *
 *   * no route that reads dataset PAYLOADS. Event rows live in dataset
 *     storage; this surface serves metadata (manifests, checksums, verdicts,
 *     coverage). A mobile client cannot "accidentally" page a gigabyte
 *     because there is no page to put the gigabyte on;
 *   * no route that mutates a version's files, counts or manifest. The only
 *     writes are (a) registering metadata for a NEW version the pipeline
 *     finalised, (b) recording a validation verdict the validator produced,
 *     and (c) withdrawing a version (quarantine/archive) - status transitions
 *     that remove capability, never add it;
 *   * no route, parameter or field that reaches a venue or an order. Datasets
 *     are frozen input to BACKTEST. The live paper path does not read these
 *     tables, and there is no switch that changes that.
 *
 * The register/validate routes are guarded by the SAME permissions that
 * start the work (dataset:ingest, dataset:validate) on purpose: whoever can
 * cause a dataset to exist can report that it exists. Splitting the
 * permissions would not add a control - the reporting side effects are
 * metadata the caller itself produced - but it would add a deadlock where a
 * worker could ingest and then be unable to register. Auditing closes the
 * accountability question, and it is applied on both.
 *
 * Route order: literal paths (`replay-ranges`, `ingestion-runs`) are declared
 * before the parameterised `:idOrKey` routes so Nest matches them exactly
 * rather than reading "replay-ranges" as a dataset key. This is not cosmetic:
 * a dataset key is validated against the hst-<hex> shape downstream, and
 * letting a route parameter swallow a word would turn a routing bug into a
 * 400 with a confusing message.
 */
@ApiTags('Datasets')
@Controller({ path: 'datasets', version: '1' })
@ApiStandardResponses()
export class DatasetsController {
  constructor(
    private readonly registry: DatasetRegistryService,
    private readonly ingestion: DatasetIngestionService,
    private readonly lifecycle: DatasetLifecycleService,
  ) {}

  // ---------------------------------------------------------------------------
  // Registry reads
  // ---------------------------------------------------------------------------

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'List historical datasets' })
  @ApiOkResponse({ description: 'Paginated dataset metadata. No event data.' })
  async list(@Query() query: ListDatasetsDto): Promise<PaginatedResult<DatasetView>> {
    return this.registry.listDatasets(query);
  }

  @Get('replay-ranges')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Validated coverage available for replay' })
  @ApiOkResponse({
    description:
      'Merged covered windows for a symbol, from VALID versions only. A range ' +
      'here can be cited directly by a backtest submission (datasetKey + ' +
      'version); a range not here may exist but is not usable, and that ' +
      'difference is the entire point of the query.',
  })
  async replayRanges(@Query() query: ReplayRangesQueryDto): Promise<ReplayRangeView[]> {
    return this.registry.replayRanges(query);
  }

  @Get('ingestion-runs')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'List ingestion runs' })
  async listRuns(@Query() query: ListIngestionRunsDto): Promise<PaginatedResult<IngestionRunView>> {
    return this.ingestion.listRuns(query);
  }

  @Get('ingestion-runs/:runId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Get one ingestion run' })
  async getRun(@Param('runId') runId: string): Promise<IngestionRunView> {
    return this.ingestion.getRun(runId);
  }

  @Get(':idOrKey')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Get one dataset by id or derived key' })
  @ApiOkResponse({
    description:
      'The dataset row. The `datasetKey` is the derived contract identity; ' +
      'content lives in per-version rows.',
  })
  async getOne(@Param('idOrKey') idOrKey: string): Promise<DatasetView> {
    return this.registry.getDataset(idOrKey);
  }

  @Get(':idOrKey/versions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'List dataset versions (newest first)' })
  async listVersions(
    @Param('idOrKey') idOrKey: string,
    @Query() query: ListDatasetVersionsDto,
  ): Promise<DatasetVersionView[]> {
    return this.registry.listVersions(idOrKey, query);
  }

  @Get(':idOrKey/versions/:version')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Get one dataset version with its manifest' })
  async getVersion(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<DatasetVersionView> {
    return this.registry.getVersion(idOrKey, version);
  }

  @Get(':idOrKey/versions/:version/files')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Paginated file receipts for a version' })
  @ApiOkResponse({
    description:
      'Per-partition digests and counts: the integrity checklist a verifier ' +
      'reconciles storage against. Paths are manifest-relative and carry no ' +
      'authority component by construction.',
  })
  async listFiles(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
    @Query() query: ListDatasetFilesDto,
  ): Promise<PaginatedResult<DatasetFileView>> {
    return this.registry.listFiles(idOrKey, version, query);
  }

  @Get(':idOrKey/versions/:version/validation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_READ)
  @ApiOperation({ summary: 'Latest validation verdict for a version' })
  @ApiOkResponse({ description: 'Null when no validation has run yet.' })
  async getValidation(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<DatasetValidationView | null> {
    return this.registry.latestValidation(idOrKey, version);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DATASET_INGEST)
  @ApiOperation({ summary: 'Queue a historical ingestion job' })
  @ApiCreatedResponse({
    description:
      'The accepted job. Downloading, normalising, validating and finalising ' +
      'run on the dataset worker against PUBLIC sources; no credential is ' +
      'used by any part of this path, and no order is placed by any part of ' +
      'it. The version becomes visible only after validation succeeds.',
  })
  async requestIngestion(
    @Body() body: RequestDatasetIngestionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetCommandAcceptedView> {
    return this.ingestion.requestIngestion(tenantId, { userId: user.userId, requestId: meta.requestId }, body);
  }

  @Post('versions/register')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.DATASET_INGEST)
  @ApiOperation({ summary: 'Register metadata for a finalised dataset version' })
  @ApiCreatedResponse({
    description:
      'The version row, created or confirmed idempotent. Re-registering the ' +
      'same (datasetKey, version) with a different content checksum is a 409: ' +
      'a published version is immutable, and this is the door it would walk ' +
      'through if it were not.',
  })
  async registerVersion(
    @Body() body: RegisterDatasetVersionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetVersionView> {
    return this.registry.registerVersion(
      { userId: user.userId, requestId: meta.requestId, tenantId },
      body,
    );
  }

  @Post(':idOrKey/versions/:version/validate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.DATASET_VALIDATE)
  @ApiOperation({ summary: 'Queue a re-validation of a version' })
  async requestValidation(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: RequestDatasetValidationDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetCommandAcceptedView> {
    return this.ingestion.requestValidation(
      tenantId,
      { userId: user.userId, requestId: meta.requestId },
      idOrKey,
      version,
      body,
    );
  }

  @Post(':idOrKey/versions/:version/validations')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.DATASET_VALIDATE)
  @ApiOperation({ summary: 'Record a validation verdict the validator produced' })
  async recordValidation(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: RecordDatasetValidationDto,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetValidationView> {
    return this.registry.recordValidation(
      { userId: user.userId, requestId: meta.requestId },
      idOrKey,
      version,
      body,
    );
  }

  @Post(':idOrKey/versions/:version/quarantine')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_QUARANTINE)
  @ApiOperation({ summary: 'Withdraw a version from replay use' })
  async quarantine(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: QuarantineDatasetVersionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetCommandAcceptedView> {
    return this.lifecycle.quarantine(
      tenantId,
      { userId: user.userId, requestId: meta.requestId },
      idOrKey,
      version,
      body,
    );
  }

  @Post(':idOrKey/versions/:version/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.DATASET_ARCHIVE)
  @ApiOperation({ summary: 'Archive a version (typed confirmation; never deletes)' })
  async archive(
    @Param('idOrKey') idOrKey: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() body: ArchiveDatasetVersionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<DatasetCommandAcceptedView> {
    return this.lifecycle.archive(
      tenantId,
      { userId: user.userId, requestId: meta.requestId },
      idOrKey,
      version,
      body,
    );
  }
}

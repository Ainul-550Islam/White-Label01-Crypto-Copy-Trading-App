import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  Permission,
  type AuthenticatedActor,
  type FeatureFlagDto,
  type TenantFeatureFlagDto,
} from '@wlct/shared-types';

import { FeatureFlagsService } from './feature-flags.service';
import { SetTenantFlagDto, UpsertFeatureFlagDto } from './dto/feature-flag.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { PlatformOnly, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';

@ApiTags('Feature flags')
@Controller({ path: 'feature-flags', version: '1' })
@ApiStandardResponses()
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Get('resolved')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolved flag map for the current organisation',
    description: 'The effective on/off state after tenant overrides are applied.',
  })
  @ApiOkResponse({ description: 'Map of flag key to boolean.' })
  async resolved(@TenantId() tenantId: string): Promise<Record<string, boolean>> {
    return this.featureFlags.getAllForTenant(tenantId);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FEATURE_FLAG_READ)
  @ApiOperation({ summary: 'List tenant flag overrides' })
  @ApiOkResponse({ description: 'Tenant overrides.' })
  async listForTenant(@TenantId() tenantId: string): Promise<TenantFeatureFlagDto[]> {
    return this.featureFlags.listForTenant(tenantId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.FEATURE_FLAG_MANAGE)
  @Audited(AuditAction.FEATURE_FLAG_UPDATED, 'TenantFeatureFlag')
  @ApiOperation({ summary: 'Enable or disable a feature for the current organisation' })
  @ApiOkResponse({ description: 'The stored override.' })
  async setForTenant(
    @Body() dto: SetTenantFlagDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantFeatureFlagDto> {
    return this.featureFlags.setForTenant(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get('definitions')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.FEATURE_FLAG_READ)
  @ApiOperation({ summary: 'List platform-wide flag definitions' })
  @ApiOkResponse({ description: 'Flag definitions.' })
  async listDefinitions(): Promise<FeatureFlagDto[]> {
    return this.featureFlags.listDefinitions();
  }

  @Post('definitions')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.FEATURE_FLAG_MANAGE)
  @Audited(AuditAction.FEATURE_FLAG_UPDATED, 'FeatureFlag')
  @ApiOperation({ summary: 'Create or update a platform-wide flag definition' })
  @ApiOkResponse({ description: 'The stored definition.' })
  async upsertDefinition(
    @Body() dto: UpsertFeatureFlagDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<FeatureFlagDto> {
    return this.featureFlags.upsertDefinition(dto, {
      actorId: actor.userId,
      tenantId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }
}

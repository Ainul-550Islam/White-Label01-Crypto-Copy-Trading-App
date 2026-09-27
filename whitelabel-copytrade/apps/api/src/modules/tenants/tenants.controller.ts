import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  Permission,
  type AuthenticatedActor,
  type PaginatedResult,
  type TenantBrandingDto,
  type TenantDto,
  type TenantPublicConfigDto,
  type TenantSettingDto,
} from '@wlct/shared-types';

import { TenantsService } from './tenants.service';
import { TenantBrandingService } from './tenant-branding.service';
import { TenantSettingsService } from './tenant-settings.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto, UpdateTenantStatusDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { CreateTenantDomainDto, UpsertTenantSettingsDto } from './dto/tenant-settings.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant, TenantId } from '../../common/decorators/current-tenant.decorator';
import { PlatformOnly, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { Audited } from '../../common/decorators/audit.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import type { TenantContext } from '../../common/types/request.types';

/**
 * Tenant administration.
 *
 * Two audiences share this controller:
 *  - platform operators (`@PlatformOnly`) who create and suspend tenants;
 *  - tenant administrators who may only ever touch the tenant carried by their
 *    own JWT, which the global `TenantGuard` has already pinned to the request.
 *
 * Route parameters never widen access: `:id` endpoints are platform-only, while
 * tenant-scoped endpoints read the id from the authenticated context.
 */
@ApiTags('Tenants')
@Controller({ path: 'tenants', version: '1' })
@ApiStandardResponses()
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly brandingService: TenantBrandingService,
    private readonly settingsService: TenantSettingsService,
  ) {}

  @Get('public-config')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bootstrap configuration for the resolved tenant',
    description:
      'Unauthenticated. The tenant is resolved from the custom domain, sub-domain or X-Tenant-Slug header. Returns branding, locales and feature flags only.',
  })
  @ApiOkResponse({ description: 'Public tenant configuration.' })
  async publicConfig(@CurrentTenant() tenant: TenantContext): Promise<TenantPublicConfigDto> {
    return this.tenantsService.getPublicConfig(tenant.tenantId);
  }

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'Fetch the organisation of the authenticated user' })
  @ApiOkResponse({ description: 'The current tenant.' })
  async current(@TenantId() tenantId: string): Promise<TenantDto> {
    return this.tenantsService.findById(tenantId);
  }

  @Patch('current')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Audited(AuditAction.TENANT_UPDATED, 'Tenant')
  @ApiOperation({ summary: 'Update the organisation of the authenticated user' })
  @ApiOkResponse({ description: 'The updated tenant.' })
  async updateCurrent(
    @Body() dto: UpdateTenantDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantDto> {
    return this.tenantsService.update(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get('current/branding')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_BRANDING_READ)
  @ApiOperation({ summary: 'Read white-label branding' })
  @ApiOkResponse({ description: 'Branding configuration.' })
  async getBranding(@TenantId() tenantId: string): Promise<TenantBrandingDto> {
    return this.brandingService.get(tenantId);
  }

  @Patch('current/branding')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_BRANDING_UPDATE)
  @Audited(AuditAction.TENANT_BRANDING_UPDATED, 'TenantBranding')
  @ApiOperation({
    summary: 'Update white-label branding',
    description: 'Custom CSS is sanitised server-side before it is stored.',
  })
  @ApiOkResponse({ description: 'Updated branding configuration.' })
  async updateBranding(
    @Body() dto: UpdateBrandingDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantBrandingDto> {
    return this.brandingService.update(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get('current/settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_SETTINGS_READ)
  @ApiOperation({
    summary: 'List tenant settings',
    description: 'Secret settings are returned as { configured: true } and never in plaintext.',
  })
  @ApiOkResponse({ description: 'Tenant settings.' })
  async listSettings(
    @TenantId() tenantId: string,
    @Query('category') category?: string,
  ): Promise<TenantSettingDto[]> {
    return this.settingsService.list(tenantId, category);
  }

  @Post('current/settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_SETTINGS_UPDATE)
  @Audited(AuditAction.TENANT_SETTING_UPDATED, 'TenantSetting')
  @ApiOperation({ summary: 'Create or update tenant settings in bulk' })
  @ApiOkResponse({ description: 'The stored settings.' })
  async upsertSettings(
    @Body() dto: UpsertTenantSettingsDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantSettingDto[]> {
    return this.settingsService.upsertMany(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Delete('current/settings/:key')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_SETTINGS_UPDATE)
  @Audited(AuditAction.TENANT_SETTING_UPDATED, 'TenantSetting')
  @ApiOperation({ summary: 'Delete a tenant setting' })
  @ApiOkResponse({ description: 'Deletion acknowledgement.' })
  async deleteSetting(
    @Param('key') key: string,
    @TenantId() tenantId: string,
  ): Promise<{ key: string; deleted: true }> {
    return this.settingsService.remove(tenantId, key);
  }

  @Post('current/domains')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permission.TENANT_DOMAIN_MANAGE)
  @Audited(AuditAction.TENANT_DOMAIN_ADDED, 'TenantDomain')
  @ApiOperation({
    summary: 'Register a custom domain',
    description:
      'Returns a verification token that must be published as a DNS TXT record before the domain is activated.',
  })
  @ApiCreatedResponse({ description: 'The pending domain.' })
  async addDomain(
    @Body() dto: CreateTenantDomainDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; domain: string; verificationToken: string; status: string }> {
    return this.tenantsService.addDomain(tenantId, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Delete('current/domains/:domainId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.TENANT_DOMAIN_MANAGE)
  @Audited(AuditAction.TENANT_DOMAIN_REMOVED, 'TenantDomain')
  @ApiOperation({ summary: 'Remove a custom domain' })
  @ApiOkResponse({ description: 'Deletion acknowledgement.' })
  async removeDomain(
    @Param('domainId', ParseUuidPipe) domainId: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; deleted: true }> {
    return this.tenantsService.removeDomain(tenantId, domainId, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'List every organisation on the platform' })
  @ApiOkResponse({ description: 'Paginated tenants.' })
  async list(@Query() query: ListTenantsDto): Promise<PaginatedResult<TenantDto>> {
    return this.tenantsService.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_CREATE)
  @Audited(AuditAction.TENANT_CREATED, 'Tenant')
  @ApiOperation({
    summary: 'Provision a new organisation',
    description:
      'Creates the tenant, its branding record, a private copy of the system roles, feature flag defaults and optionally the first administrator - atomically.',
  })
  @ApiCreatedResponse({ description: 'The provisioned tenant.' })
  async create(
    @Body() dto: CreateTenantDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantDto> {
    return this.tenantsService.create(dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_READ)
  @ApiOperation({ summary: 'Fetch any organisation by id' })
  @ApiOkResponse({ description: 'The tenant.' })
  async findById(@Param('id', ParseUuidPipe) id: string): Promise<TenantDto> {
    return this.tenantsService.findById(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_UPDATE)
  @Audited(AuditAction.TENANT_UPDATED, 'Tenant')
  @ApiOperation({ summary: 'Update any organisation by id' })
  @ApiOkResponse({ description: 'The updated tenant.' })
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantDto> {
    return this.tenantsService.update(id, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_SUSPEND)
  @Audited(AuditAction.TENANT_SUSPENDED, 'Tenant')
  @ApiOperation({
    summary: 'Change organisation status',
    description: 'Suspending or archiving a tenant revokes every live session and refresh token.',
  })
  @ApiOkResponse({ description: 'The updated tenant.' })
  async updateStatus(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<TenantDto> {
    return this.tenantsService.updateStatus(id, dto, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @PlatformOnly()
  @RequirePermissions(Permission.TENANT_DELETE)
  @Audited(AuditAction.TENANT_DELETED, 'Tenant')
  @ApiOperation({
    summary: 'Soft-delete an organisation',
    description: 'Marks the tenant archived and deleted; data is retained for compliance.',
  })
  @ApiOkResponse({ description: 'Deletion acknowledgement.' })
  async remove(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; deleted: true }> {
    return this.tenantsService.softDelete(id, {
      actorId: actor.userId,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }
}

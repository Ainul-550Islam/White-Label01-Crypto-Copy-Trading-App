// # Responsibility: exposes the Batch 04 tenant-scoped API endpoints for this capability.
// # Provides authenticated, tenant-bound access to only the caller's own privacy requests and export metadata.
import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Body } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { DataAccessRequestDto, DataExportRequestDto } from './dto/data-access-request.dto';
import { PrivacyRequestService } from '../governance/privacy-request.service';
import { PrivacyExportService } from '../governance/privacy-export.service';
import { PrivacyExportDownloadService } from './privacy-export-download.service';
import { PrivacyRequestType } from '../governance/governance.types';

@Controller({ path: 'privacy/requests', version: '1' })
export class PrivacySelfServiceController {
  constructor(private readonly requests: PrivacyRequestService, private readonly exports: PrivacyExportService, private readonly downloads: PrivacyExportDownloadService) {}

  @Get()
  @RequirePermissions(Permission.USER_READ)
  list(@CurrentUser() actor: AuthenticatedActor) {
    return this.requests.listRequests(actor.tenantId, { subjectUserId: actor.userId });
  }

  @Post()
  @RequirePermissions(Permission.USER_UPDATE)
  async create(@CurrentUser() actor: AuthenticatedActor, @Body() dto: DataAccessRequestDto) {
    const requestType = dto.requestType === 'ACCESS' ? PrivacyRequestType.ACCESS : dto.requestType === 'EXPORT' ? PrivacyRequestType.EXPORT : PrivacyRequestType.DELETION;
    if (requestType === PrivacyRequestType.DELETION) throw new BadRequestException('Use the step-up protected deletion route');
    return this.requests.createRequest({ tenantId: actor.tenantId, subjectUserId: actor.userId, subjectType: 'USER', requestType, jurisdiction: dto.jurisdiction, reason: dto.reason, idempotencyKey: dto.idempotencyKey, correlationId: dto.correlationId, createdBy: actor.userId });
  }

  @Post('deletion')
  @RequirePermissions(Permission.USER_UPDATE)
  @RequireStepUp('DATA_DELETION_REQUEST')
  createDeletion(@CurrentUser() actor: AuthenticatedActor, @Body() dto: DataAccessRequestDto) {
    return this.requests.createRequest({ tenantId: actor.tenantId, subjectUserId: actor.userId, subjectType: 'USER', requestType: PrivacyRequestType.DELETION, jurisdiction: dto.jurisdiction, reason: dto.reason, idempotencyKey: dto.idempotencyKey, correlationId: dto.correlationId, createdBy: actor.userId });
  }

  @Get(':requestId')
  @RequirePermissions(Permission.USER_READ)
  async get(@CurrentUser() actor: AuthenticatedActor, @Param('requestId') requestId: string) {
    const request = await this.requests.getRequest(actor.tenantId, requestId);
    if (request.subjectUserId !== actor.userId) throw new NotFoundException('Privacy request not found');
    return request;
  }

  @Post(':requestId/export')
  @RequirePermissions(Permission.USER_UPDATE)
  async requestExport(@CurrentUser() actor: AuthenticatedActor, @Param('requestId') requestId: string, @Body() dto: DataExportRequestDto) {
    const request = await this.requests.getRequest(actor.tenantId, requestId);
    if (request.subjectUserId !== actor.userId) throw new NotFoundException('Privacy request not found');
    if (request.requestType !== PrivacyRequestType.EXPORT && request.requestType !== PrivacyRequestType.ACCESS) throw new BadRequestException('Only an access or export request can generate an export');
    return this.exports.generateExport({ tenantId: actor.tenantId, requestId, subjectUserId: actor.userId, jurisdiction: request.jurisdiction, correlationId: dto.correlationId, operatorId: actor.userId });
  }

  @Post(':requestId/download-token')
  @RequirePermissions(Permission.USER_READ)
  async issueDownloadToken(@CurrentUser() actor: AuthenticatedActor, @Param('requestId') requestId: string) {
    const request = await this.requests.getRequest(actor.tenantId, requestId);
    if (request.subjectUserId !== actor.userId) throw new NotFoundException('Privacy request not found');
    return this.downloads.issue(actor.tenantId, actor.userId, requestId);
  }

  @Get('download/:token')
  @RequirePermissions(Permission.USER_READ)
  download(@CurrentUser() actor: AuthenticatedActor, @Param('token') token: string) {
    return this.downloads.consume(actor.tenantId, actor.userId, token);
  }
}

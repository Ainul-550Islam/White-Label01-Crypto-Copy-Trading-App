import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type PaginatedResult } from '@wlct/shared-types';

import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import type { AuditLogEntity } from './audit.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import type { AuthenticatedActor } from '@wlct/shared-types';

@ApiTags('Audit')
@Controller({ path: 'audit-logs', version: '1' })
@ApiStandardResponses()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.AUDIT_LOG_READ)
  @ApiOperation({
    summary: 'List audit log entries',
    description:
      'Returns the tenant-scoped audit trail. Platform operators may pass `tenantId` to inspect another organisation.',
  })
  @ApiOkResponse({ description: 'Paginated audit records.' })
  async list(
    @Query() query: ListAuditLogsDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<PaginatedResult<AuditLogEntity>> {
    // Non-platform callers can never widen the scope beyond their own tenant.
    const scopedTenantId = actor.isPlatformUser ? (query.tenantId ?? tenantId) : tenantId;

    return this.auditService.list({
      ...query,
      tenantId: scopedTenantId,
    });
  }
}

// # Responsibility: exposes owner-scoped finalized statements and step-up-protected platform generation/corrections.
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions, PlatformOnly } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { GenerateProfitShareStatementDto } from './profit-share-statement.dto';
import { ProfitShareStatementService } from './profit-share-statement.service';

@ApiTags('Billing - profit-share statements')
@Controller({path:'billing/statements',version:'1'})
@ApiStandardResponses()
export class ProfitShareStatementController {
  constructor(private readonly service:ProfitShareStatementService){}
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  @ApiOperation({summary:"List current user's finalized profit-share statements",description:'Tenant/user scoped to the authenticated follower or trader; statement totals are based on posted ledger entries.'})
  list(@TenantId() tenantId:string,@CurrentUser() actor:AuthenticatedActor){return this.service.listForUser(tenantId,actor.userId);}
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  @ApiOperation({summary:'Read one owned profit-share statement',description:'Only a statement for the authenticated follower or trader in the resolved tenant can be read.'})
  get(@TenantId() tenantId:string,@CurrentUser() actor:AuthenticatedActor,@Param('id',ParseUuidPipe) id:string){return this.service.getForUser(tenantId,actor.userId,id);}
}

@ApiTags('Billing - profit-share statement administration')
@Controller({path:'admin/billing/statements',version:'1'})
@ApiStandardResponses()
@PlatformOnly()
@RequirePermissions(Permission.PLATFORM_MANAGE)
export class AdminProfitShareStatementController {
  constructor(private readonly service:ProfitShareStatementService){}
  @Post('generate') @HttpCode(HttpStatus.CREATED) @RequireStepUp('STATEMENT_REGENERATE')
  @ApiOperation({summary:'Generate or correct finalized statements from posted performance-fee ledger entries',description:'Step-up protected; each statement version is immutable and corrections create a superseding version.'})
  generate(@TenantId() tenantId:string,@Body() dto:GenerateProfitShareStatementDto){return this.service.generate({...dto,tenantId},Boolean(dto.correction));}
  @Post(':id/finalize') @HttpCode(HttpStatus.OK) @RequireStepUp('STATEMENT_REGENERATE')
  @ApiOperation({summary:'Finalize a draft profit-share statement',description:'Only draft statements can transition to finalized; finalized amounts are immutable.'})
  finalize(@TenantId() tenantId:string,@Param('id',ParseUuidPipe) id:string){return this.service.finalize(tenantId,id);}
}

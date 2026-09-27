import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { AuthenticatedActor, UserSessionDto } from '@wlct/shared-types';

import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { AuditService } from '../audit/audit.service';
import { RevokeSessionDto } from './dto/two-factor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

/** Device and session management for the authenticated account. */
@ApiTags('Sessions')
@Controller({ path: 'auth/sessions', version: '1' })
@ApiStandardResponses()
export class SessionsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active sessions (signed-in devices)' })
  @ApiOkResponse({ description: 'Active sessions, with the current one flagged.' })
  async list(@CurrentUser() actor: AuthenticatedActor): Promise<UserSessionDto[]> {
    return this.sessionService.listForUser(actor.userId, actor.sessionId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a single session' })
  @ApiOkResponse({ description: 'The session was revoked.' })
  async revoke(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: RevokeSessionDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ id: string; revoked: true }> {
    await this.sessionService.revoke(actor.userId, id, dto.reason ?? 'user_revoked');
    await this.tokenService.revokeSessionTokens(id, dto.reason ?? 'user_revoked');

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.SESSION_REVOKED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: id,
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return { id, revoked: true };
  }

  @Post('revoke-others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session except the current device' })
  @ApiOkResponse({ description: 'Number of sessions revoked.' })
  async revokeOthers(
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ sessionsRevoked: number }> {
    const sessionsRevoked = await this.sessionService.revokeAll(
      actor.userId,
      actor.sessionId,
      'user_revoked_others',
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.SESSION_REVOKED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'UserSession',
      resourceId: null,
      description: 'Revoked all other sessions.',
      metadata: { sessionsRevoked },
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return { sessionsRevoked };
  }
}

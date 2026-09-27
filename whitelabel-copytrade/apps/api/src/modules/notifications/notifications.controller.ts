import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedActor,
  type NotificationDto,
  type NotificationPreferenceDto,
  type PaginatedResult,
} from '@wlct/shared-types';

import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';

/**
 * Notification inbox.
 *
 * Every route is implicitly scoped to the authenticated user; there is no
 * endpoint that lets one user read another user's notifications.
 */
@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
@ApiStandardResponses()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the notifications addressed to the current user' })
  @ApiOkResponse({ description: 'Paginated notifications.' })
  async list(
    @Query() query: ListNotificationsDto,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<PaginatedResult<NotificationDto>> {
    return this.notifications.list(tenantId, actor.userId, query);
  }

  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Number of unread notifications' })
  @ApiOkResponse({ description: 'Unread count.' })
  async unreadCount(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<{ unread: number }> {
    return this.notifications.countUnread(tenantId, actor.userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'The updated notification.' })
  async markRead(
    @Param('id', ParseUuidPipe) id: string,
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<NotificationDto> {
    return this.notifications.markRead(tenantId, actor.userId, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification as read' })
  @ApiOkResponse({ description: 'Number of notifications updated.' })
  async markAllRead(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<{ updated: number }> {
    return this.notifications.markAllRead(tenantId, actor.userId);
  }

  @Get('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read notification channel preferences' })
  @ApiOkResponse({ description: 'Stored preferences.' })
  async listPreferences(
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notifications.listPreferences(actor.userId);
  }

  @Patch('preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update notification channel preferences',
    description:
      'Security-critical messages (new device, password change, 2FA changes) are always delivered in-app and by email regardless of these settings.',
  })
  @ApiOkResponse({ description: 'The updated preferences.' })
  async updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notifications.updatePreferences(actor.userId, dto);
  }
}

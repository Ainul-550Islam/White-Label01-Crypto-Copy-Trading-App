// # Responsibility: exposes the Batch 04 tenant-scoped API endpoints for this capability.
// # Exposes authenticated tenant-bound GET and PUT routes for the caller's own locale preferences.
import { Body, Controller, Get, Put } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UserPreferencesService } from './user-preferences.service';
import { UserPreferencesDto } from './dto/user-preferences.dto';

@Controller({ path: 'users/me/preferences', version: '1' })
export class UserPreferencesController {
  constructor(private readonly preferences: UserPreferencesService) {}

  @Get()
  @RequirePermissions(Permission.USER_READ)
  get(@CurrentUser() actor: AuthenticatedActor) {
    return this.preferences.get(actor.tenantId, actor.userId);
  }

  @Put()
  @RequirePermissions(Permission.USER_UPDATE)
  update(@CurrentUser() actor: AuthenticatedActor, @Body() dto: UserPreferencesDto) {
    return this.preferences.update(actor.tenantId, actor.userId, dto);
  }
}

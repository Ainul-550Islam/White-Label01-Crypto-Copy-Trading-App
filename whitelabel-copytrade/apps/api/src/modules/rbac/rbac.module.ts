import { Global, Module } from '@nestjs/common';

import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';

/**
 * Role Based Access Control.
 *
 * Exported globally because the authentication guard needs to resolve the
 * effective permission set for every request.
 */
@Global()
@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService, PermissionsService],
  exports: [RolesService, PermissionsService],
})
export class RbacModule {}

import { Module } from '@nestjs/common';

import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { EnforcementModule } from '../billing/enforcement/enforcement.module';

/**
 * User profile and administration.
 *
 * Enforcement integration (Part 2):
 *  - Imports EnforcementModule to provide PlanLimitUsersGuard
 *  - UsersService reserves maxUsers quota atomically before creation
 *  - Release on failure prevents leak
 */
@Module({
  imports: [EnforcementModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}

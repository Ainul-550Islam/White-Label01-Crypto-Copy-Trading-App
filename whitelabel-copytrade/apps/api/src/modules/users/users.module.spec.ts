// # Responsibility: verifies the users service, repository, controller, and quota enforcement module are wired.
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';
import { EnforcementModule } from '../billing/enforcement/enforcement.module';

describe('UsersModule', () => {
  it('registers tenant user providers and imports quota enforcement', () => {
    expect(Reflect.getMetadata('imports', UsersModule)).toEqual([EnforcementModule]);
    expect(Reflect.getMetadata('controllers', UsersModule)).toEqual([UsersController, UserPreferencesController]);
    expect(Reflect.getMetadata('providers', UsersModule)).toEqual([UsersService, UsersRepository, UserPreferencesService]);
    expect(Reflect.getMetadata('exports', UsersModule)).toEqual([UsersService, UsersRepository]);
  });
});

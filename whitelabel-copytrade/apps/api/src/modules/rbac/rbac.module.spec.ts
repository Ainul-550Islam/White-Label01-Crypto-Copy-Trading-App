// # Responsibility: verifies RBAC services and controllers are registered and exported by the module.
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { RbacModule } from './rbac.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

describe('RbacModule', () => {
  it('registers both controllers and exports both authorization services', () => {
    expect(Reflect.getMetadata('controllers', RbacModule)).toEqual([RolesController, PermissionsController]);
    expect(Reflect.getMetadata('providers', RbacModule)).toEqual([RolesService, PermissionsService]);
    expect(Reflect.getMetadata('exports', RbacModule)).toEqual([RolesService, PermissionsService]);
  });
});

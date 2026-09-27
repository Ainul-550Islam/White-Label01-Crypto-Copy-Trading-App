import { SetMetadata, applyDecorators, type CustomDecorator } from '@nestjs/common';
import type { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY, PLATFORM_ONLY_KEY } from '../constants/metadata.constants';

export type PermissionMode = 'all' | 'any';

/** Requires the caller to hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'all' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Requires at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]): CustomDecorator<string> =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'any' satisfies PermissionMode),
  ) as CustomDecorator<string>;

/** Restricts a route to platform staff (super admins), regardless of tenant. */
export const PlatformOnly = (): CustomDecorator<string> => SetMetadata(PLATFORM_ONLY_KEY, true);

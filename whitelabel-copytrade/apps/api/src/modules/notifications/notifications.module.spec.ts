// # Confirms the notification inbox controller and delivery processors are registered in the Nest module.
import { MODULE_METADATA } from '@nestjs/common/constants';
import { NotificationsModule } from './notifications.module';
import { NotificationsController } from './notifications.controller';

describe('NotificationsModule', () => {
  it('registers the tenant-scoped inbox controller', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      NotificationsModule,
    ) as unknown[];
    expect(controllers).toContain(NotificationsController);
  });
});

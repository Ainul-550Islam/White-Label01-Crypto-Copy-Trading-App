// # Verifies notification catalog defaults, critical delivery policy, and fail-closed generic templates.
import { NotificationChannel } from '@wlct/shared-types';
import { NOTIFICATION_TEMPLATES, resolveTemplate } from './notification.templates';

describe('notification templates', () => {
  it('retains in-app and email delivery for critical security notifications', () => {
    const template = NOTIFICATION_TEMPLATES['security.new_device'];
    expect(template.critical).toBe(true);
    expect(template.channels).toEqual(
      expect.arrayContaining([NotificationChannel.IN_APP, NotificationChannel.EMAIL]),
    );
  });

  it('maps unknown event types to a non-critical in-app fallback', () => {
    expect(resolveTemplate('unknown.event')).toMatchObject({
      type: 'unknown.event',
      channels: [NotificationChannel.IN_APP],
      critical: false,
    });
  });
});

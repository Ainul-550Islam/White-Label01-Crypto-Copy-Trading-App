import { NotificationChannel } from '@wlct/shared-types';

/**
 * Catalogue of transactional notification types.
 *
 * Templates reference i18n keys rather than literal copy so every brand and
 * locale renders from the same catalogue. `channels` is the *maximum* fan-out;
 * a user's notification preferences can narrow it, never widen it.
 *
 * `critical` templates (security and account integrity) ignore preferences for
 * the e-mail channel: a user must always be told when their credentials or
 * devices change, which is a regulatory as well as a security requirement.
 */
export interface NotificationTemplate {
  type: string;
  category: string;
  titleKey: string;
  bodyKey: string;
  channels: NotificationChannel[];
  critical: boolean;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  'account.welcome': {
    type: 'account.welcome',
    category: 'account',
    titleKey: 'notification.account.welcome.title',
    bodyKey: 'notification.account.welcome.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: false,
  },
  'account.invited': {
    type: 'account.invited',
    category: 'account',
    titleKey: 'notification.account.invited.title',
    bodyKey: 'notification.account.invited.body',
    channels: [NotificationChannel.EMAIL],
    critical: true,
  },
  'account.email_verification': {
    type: 'account.email_verification',
    category: 'account',
    titleKey: 'notification.account.email_verification.title',
    bodyKey: 'notification.account.email_verification.body',
    channels: [NotificationChannel.EMAIL],
    critical: true,
  },
  'account.password_reset': {
    type: 'account.password_reset',
    category: 'account',
    titleKey: 'notification.account.password_reset.title',
    bodyKey: 'notification.account.password_reset.body',
    channels: [NotificationChannel.EMAIL],
    critical: true,
  },
  'account.suspended': {
    type: 'account.suspended',
    category: 'account',
    titleKey: 'notification.account.suspended.title',
    bodyKey: 'notification.account.suspended.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: true,
  },
  'security.new_device': {
    type: 'security.new_device',
    category: 'security',
    titleKey: 'notification.security.new_device.title',
    bodyKey: 'notification.security.new_device.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.PUSH],
    critical: true,
  },
  'security.password_changed': {
    type: 'security.password_changed',
    category: 'security',
    titleKey: 'notification.security.password_changed.title',
    bodyKey: 'notification.security.password_changed.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: true,
  },
  'security.two_factor_enabled': {
    type: 'security.two_factor_enabled',
    category: 'security',
    titleKey: 'notification.security.two_factor_enabled.title',
    bodyKey: 'notification.security.two_factor_enabled.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: true,
  },
  'security.two_factor_disabled': {
    type: 'security.two_factor_disabled',
    category: 'security',
    titleKey: 'notification.security.two_factor_disabled.title',
    bodyKey: 'notification.security.two_factor_disabled.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: true,
  },
  'security.sessions_revoked': {
    type: 'security.sessions_revoked',
    category: 'security',
    titleKey: 'notification.security.sessions_revoked.title',
    bodyKey: 'notification.security.sessions_revoked.body',
    channels: [NotificationChannel.IN_APP],
    critical: false,
  },
  'billing.subscription_activated': {
    type: 'billing.subscription_activated',
    category: 'billing',
    titleKey: 'notification.billing.subscription_activated.title',
    bodyKey: 'notification.billing.subscription_activated.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: false,
  },
  'billing.payment_failed': {
    type: 'billing.payment_failed',
    category: 'billing',
    titleKey: 'notification.billing.payment_failed.title',
    bodyKey: 'notification.billing.payment_failed.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: true,
  },
  'billing.subscription_cancelled': {
    type: 'billing.subscription_cancelled',
    category: 'billing',
    titleKey: 'notification.billing.subscription_cancelled.title',
    bodyKey: 'notification.billing.subscription_cancelled.body',
    channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
    critical: false,
  },
};

/** Fallback used when a caller enqueues a type that is not in the catalogue. */
export const GENERIC_TEMPLATE: NotificationTemplate = {
  type: 'generic',
  category: 'general',
  titleKey: 'notification.generic.title',
  bodyKey: 'notification.generic.body',
  channels: [NotificationChannel.IN_APP],
  critical: false,
};

export function resolveTemplate(type: string): NotificationTemplate {
  return NOTIFICATION_TEMPLATES[type] ?? { ...GENERIC_TEMPLATE, type };
}

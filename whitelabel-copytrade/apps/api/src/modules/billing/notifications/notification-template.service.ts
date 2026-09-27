import { Injectable, Logger } from '@nestjs/common';
import { BillingNotificationEventKey } from './billing-notification.types';

/**
 * Resolves and renders localized billing/customer templates using structured variables
 * from canonical billing data. No secrets, no hardcoded plan prices.
 */

export interface TemplateDefinition {
  key: string;
  eventKey: BillingNotificationEventKey;
  locale: string;
  channel: string;
  subject: string;
  title: string;
  body: string;
  htmlBody?: string;
  variables: string[];
}

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  private readonly templates: Record<string, TemplateDefinition> = {
    // Payment
    [BillingNotificationEventKey.PAYMENT_SUCCEEDED]: {
      key: 'payment_succeeded',
      eventKey: BillingNotificationEventKey.PAYMENT_SUCCEEDED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payment Successful - {{appName}}',
      title: 'Payment Successful',
      body: 'Hello {{customerName}},\n\nYour payment of {{amount}} {{currency}} for {{planName}} has been successfully processed.\n\nTenant: {{tenantName}}\nPlan: {{planName}} ({{planCode}})\nAmount: {{amount}} {{currency}}\nStatus: {{paymentStatus}}\n\nThank you for your payment.\n\nSupport: {{supportEmail}}',
      htmlBody: '<p>Hello {{customerName}},</p><p>Your payment of <strong>{{amount}} {{currency}}</strong> for {{planName}} has been successfully processed.</p><p>Tenant: {{tenantName}}<br>Plan: {{planName}} ({{planCode}})<br>Amount: {{amount}} {{currency}}<br>Status: {{paymentStatus}}</p><p>Thank you for your payment.</p><p>Support: {{supportEmail}}</p>',
      variables: ['customerName', 'tenantName', 'planName', 'planCode', 'amount', 'currency', 'paymentStatus', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.PAYMENT_FAILED]: {
      key: 'payment_failed',
      eventKey: BillingNotificationEventKey.PAYMENT_FAILED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payment Failed - {{appName}} - Action Required',
      title: 'Payment Failed',
      body: 'Hello {{customerName}},\n\nYour payment of {{amount}} {{currency}} for {{planName}} has failed.\n\nTenant: {{tenantName}}\nPlan: {{planName}}\nAmount: {{amount}} {{currency}}\nStatus: {{paymentStatus}}\n\nPlease update your payment method or try again.\n\nSupport: {{supportEmail}}',
      htmlBody: '<p>Hello {{customerName}},</p><p>Your payment of <strong>{{amount}} {{currency}}</strong> for {{planName}} has failed.</p><p>Tenant: {{tenantName}}<br>Plan: {{planName}}<br>Amount: {{amount}} {{currency}}<br>Status: {{paymentStatus}}</p><p>Please update your payment method or try again.</p><p>Support: {{supportEmail}}</p>',
      variables: ['customerName', 'tenantName', 'planName', 'amount', 'currency', 'paymentStatus', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.PAYMENT_PENDING]: {
      key: 'payment_pending',
      eventKey: BillingNotificationEventKey.PAYMENT_PENDING,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payment Pending - {{appName}}',
      title: 'Payment Pending',
      body: 'Hello {{customerName}},\n\nYour payment of {{amount}} {{currency}} for {{planName}} is pending processing.\n\nTenant: {{tenantName}}\nStatus: {{paymentStatus}}\n\nWe will notify you once confirmed.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'amount', 'currency', 'paymentStatus', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.INVOICE_FINALIZED]: {
      key: 'invoice_finalized',
      eventKey: BillingNotificationEventKey.INVOICE_FINALIZED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Invoice {{invoiceNumber}} Finalized - {{appName}}',
      title: 'Invoice Finalized',
      body: 'Hello {{customerName}},\n\nInvoice {{invoiceNumber}} has been finalized.\n\nTenant: {{tenantName}}\nInvoice: {{invoiceNumber}}\nAmount: {{amount}} {{currency}}\nPlan: {{planName}}\n\nYou can access your invoice in the billing portal.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'invoiceNumber', 'amount', 'currency', 'planName', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.INVOICE_PAID]: {
      key: 'invoice_paid',
      eventKey: BillingNotificationEventKey.INVOICE_PAID,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Invoice {{invoiceNumber}} Paid - {{appName}}',
      title: 'Invoice Paid',
      body: 'Hello {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} {{currency}} has been paid.\n\nTenant: {{tenantName}}\nPlan: {{planName}}\n\nThank you.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'invoiceNumber', 'amount', 'currency', 'planName', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.SUBSCRIPTION_ACTIVATED]: {
      key: 'subscription_activated',
      eventKey: BillingNotificationEventKey.SUBSCRIPTION_ACTIVATED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Subscription Activated - {{planName}} - {{appName}}',
      title: 'Subscription Activated',
      body: 'Hello {{customerName}},\n\nYour subscription to {{planName}} ({{planCode}}) has been activated.\n\nTenant: {{tenantName}}\nRenewal Date: {{renewalDate}}\n\nWelcome!\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'planCode', 'renewalDate', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.SUBSCRIPTION_CHANGED]: {
      key: 'subscription_changed',
      eventKey: BillingNotificationEventKey.SUBSCRIPTION_CHANGED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Subscription Changed - {{planName}} - {{appName}}',
      title: 'Subscription Changed',
      body: 'Hello {{customerName}},\n\nYour subscription has been changed to {{planName}} ({{planCode}}).\n\nTenant: {{tenantName}}\nNew Plan: {{planName}}\nRenewal Date: {{renewalDate}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'planCode', 'renewalDate', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.SUBSCRIPTION_CANCELLATION_SCHEDULED]: {
      key: 'subscription_cancellation_scheduled',
      eventKey: BillingNotificationEventKey.SUBSCRIPTION_CANCELLATION_SCHEDULED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Subscription Cancellation Scheduled - {{appName}}',
      title: 'Subscription Cancellation Scheduled',
      body: 'Hello {{customerName}},\n\nYour subscription to {{planName}} has been scheduled for cancellation at period end.\n\nTenant: {{tenantName}}\nRenewal Date: {{renewalDate}}\n\nYou can resume anytime before renewal.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'renewalDate', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.SUBSCRIPTION_RESUMED]: {
      key: 'subscription_resumed',
      eventKey: BillingNotificationEventKey.SUBSCRIPTION_RESUMED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Subscription Resumed - {{planName}} - {{appName}}',
      title: 'Subscription Resumed',
      body: 'Hello {{customerName}},\n\nYour subscription to {{planName}} has been resumed.\n\nTenant: {{tenantName}}\nRenewal Date: {{renewalDate}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'renewalDate', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.TRIAL_ENDING]: {
      key: 'trial_ending',
      eventKey: BillingNotificationEventKey.TRIAL_ENDING,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Trial Ending Soon - {{appName}}',
      title: 'Trial Ending',
      body: 'Hello {{customerName}},\n\nYour trial for {{planName}} ends on {{trialEndsAt}}.\n\nTenant: {{tenantName}}\nPlan: {{planName}}\n\nAdd payment method to continue.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'planName', 'trialEndsAt', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.DUNNING_RETRY]: {
      key: 'dunning_retry',
      eventKey: BillingNotificationEventKey.DUNNING_RETRY,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payment Retry Scheduled - {{appName}}',
      title: 'Payment Retry',
      body: 'Hello {{customerName}},\n\nWe will retry your payment of {{amount}} {{currency}}.\n\nAttempt: {{dunningAttempt}}/{{dunningMaxAttempts}}\nNext Retry: {{nextRetryAt}}\n\nPlease ensure sufficient funds.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'amount', 'currency', 'dunningAttempt', 'dunningMaxAttempts', 'nextRetryAt', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.DUNNING_FINAL_FAILURE]: {
      key: 'dunning_final_failure',
      eventKey: BillingNotificationEventKey.DUNNING_FINAL_FAILURE,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payment Failed - Final Notice - {{appName}}',
      title: 'Payment Final Failure',
      body: 'Hello {{customerName}},\n\nYour payment of {{amount}} {{currency}} has failed after {{dunningMaxAttempts}} attempts.\n\nTenant: {{tenantName}}\n\nYour subscription may be suspended. Please update payment method.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'amount', 'currency', 'dunningMaxAttempts', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.USAGE_THRESHOLD_REACHED]: {
      key: 'usage_threshold_reached',
      eventKey: BillingNotificationEventKey.USAGE_THRESHOLD_REACHED,
      locale: 'en',
      channel: 'IN_APP',
      subject: 'Usage Alert - {{meterKey}} {{usagePercentage}}%',
      title: 'Usage Threshold Reached',
      body: 'Hello {{customerName}},\n\nYour usage for {{meterKey}} has reached {{usagePercentage}}%.\n\nCurrent: {{currentUsage}}/{{maxLimit}}\nTenant: {{tenantName}}\n\nConsider upgrading your plan.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'meterKey', 'usagePercentage', 'currentUsage', 'maxLimit', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.USAGE_OVERAGE_DETECTED]: {
      key: 'usage_overage_detected',
      eventKey: BillingNotificationEventKey.USAGE_OVERAGE_DETECTED,
      locale: 'en',
      channel: 'IN_APP',
      subject: 'Overage Detected - {{meterKey}}',
      title: 'Overage Detected',
      body: 'Hello {{customerName}},\n\nOverage detected for {{meterKey}}.\n\nAllowed: {{maxLimit}}\nActual: {{currentUsage}}\nExcess: {{overageQuantity}}\nTenant: {{tenantName}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'meterKey', 'maxLimit', 'currentUsage', 'overageQuantity', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION]: {
      key: 'custom_domain_verification',
      eventKey: BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Custom Domain Verified - {{domain}} - {{appName}}',
      title: 'Custom Domain Verified',
      body: 'Hello {{customerName}},\n\nYour custom domain {{domain}} has been verified and is now active.\n\nTenant: {{tenantName}}\nDomain: {{domain}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'domain', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION_FAILED]: {
      key: 'custom_domain_verification_failed',
      eventKey: BillingNotificationEventKey.CUSTOM_DOMAIN_VERIFICATION_FAILED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Custom Domain Verification Failed - {{domain}} - {{appName}}',
      title: 'Custom Domain Verification Failed',
      body: 'Hello {{customerName}},\n\nVerification for custom domain {{domain}} has failed.\n\nTenant: {{tenantName}}\nDomain: {{domain}}\n\nPlease check DNS configuration and retry.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'domain', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.FEE_SETTLEMENT_FINALIZED]: {
      key: 'fee_settlement_finalized',
      eventKey: BillingNotificationEventKey.FEE_SETTLEMENT_FINALIZED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Fee Settlement Finalized - {{settlementId}} - {{appName}}',
      title: 'Fee Settlement Finalized',
      body: 'Hello {{customerName}},\n\nFee settlement {{settlementId}} for {{amount}} {{currency}} has been finalized.\n\nTenant: {{tenantName}}\nSettlement: {{settlementId}}\nAmount: {{amount}} {{currency}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'settlementId', 'amount', 'currency', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.PAYOUT_SUCCEEDED]: {
      key: 'payout_succeeded',
      eventKey: BillingNotificationEventKey.PAYOUT_SUCCEEDED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payout Successful - {{amount}} {{currency}} - {{appName}}',
      title: 'Payout Successful',
      body: 'Hello {{customerName}},\n\nYour payout of {{amount}} {{currency}} has been successfully processed.\n\nTenant: {{tenantName}}\nPayout ID: {{payoutId}}\nStatus: {{payoutStatus}}\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'payoutId', 'amount', 'currency', 'payoutStatus', 'appName', 'supportEmail'],
    },
    [BillingNotificationEventKey.PAYOUT_FAILED]: {
      key: 'payout_failed',
      eventKey: BillingNotificationEventKey.PAYOUT_FAILED,
      locale: 'en',
      channel: 'EMAIL',
      subject: 'Payout Failed - {{appName}}',
      title: 'Payout Failed',
      body: 'Hello {{customerName}},\n\nYour payout of {{amount}} {{currency}} has failed.\n\nTenant: {{tenantName}}\nPayout ID: {{payoutId}}\nStatus: {{payoutStatus}}\n\nPlease contact support.\n\nSupport: {{supportEmail}}',
      variables: ['customerName', 'tenantName', 'payoutId', 'amount', 'currency', 'payoutStatus', 'appName', 'supportEmail'],
    },
  };

  resolveTemplate(eventKey: BillingNotificationEventKey, locale: string = 'en', channel: string = 'EMAIL'): TemplateDefinition | null {
    // Try exact match with locale and channel
    const exactKey = `${eventKey}_${locale}_${channel}`;
    // For simplicity, we use eventKey as primary key, ignoring locale/channel variations for now
    // In real implementation, would have i18n and channel-specific templates
    const template = this.templates[eventKey];
    if (!template) {
      this.logger.warn(`Template not found for eventKey=${eventKey} locale=${locale} channel=${channel}`);
      return null;
    }

    // Return template with locale override if needed
    return {
      ...template,
      locale: locale || template.locale,
      channel: channel || template.channel,
    };
  }

  renderTemplate(template: TemplateDefinition, variables: Record<string, unknown>): { subject: string; title: string; body: string; htmlBody?: string } {
    try {
      const subject = this.interpolate(template.subject, variables);
      const title = this.interpolate(template.title, variables);
      const body = this.interpolate(template.body, variables);
      const htmlBody = template.htmlBody ? this.interpolate(template.htmlBody, variables) : undefined;

      return { subject, title, body, htmlBody };
    } catch (error: any) {
      this.logger.error(`Template render failed for ${template.key}: ${error.message}`);
      throw new Error(`Template render failed for ${template.key}: ${error.message}`);
    }
  }

  private interpolate(template: string, variables: Record<string, unknown>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const safeValue = this.sanitizeVariable(value);
      result = result.split(placeholder).join(safeValue);
    }

    // Check for unresolved placeholders (missing variables)
    const unresolved = result.match(/\{\{[^}]+\}\}/g);
    if (unresolved) {
      // Replace unresolved with empty string or keep for visibility, but log warning
      this.logger.warn(`Unresolved template variables: ${unresolved.join(', ')}`);
      for (const placeholder of unresolved) {
        result = result.split(placeholder).join('');
      }
    }

    return result;
  }

  private sanitizeVariable(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
      // Sanitize: no secrets, no HTML injection for text version (basic)
      // For HTML body, would need proper escaping, but for text we strip
      const forbidden = ['secret', 'privateKey', 'apiKey', 'password', 'token', 'exchange', 'credential'];
      const lower = value.toLowerCase();
      if (forbidden.some((f) => lower.includes(f) && value.length > 100)) {
        return '[REDACTED]';
      }
      return value;
    }
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  getAvailableTemplates(): string[] {
    return Object.keys(this.templates);
  }

  getTemplateKeysForEvent(eventKey: BillingNotificationEventKey): string[] {
    const template = this.templates[eventKey];
    return template ? [template.key] : [];
  }
}

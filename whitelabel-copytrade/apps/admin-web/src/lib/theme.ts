/**
 * Theme tokens.
 *
 * Kept as plain objects (no CSS-in-JS runtime) so server components can inline
 * them and tenant branding can override the CSS custom properties at request
 * time without shipping a second stylesheet.
 */
export const theme = {
  color: {
    bg: 'var(--wlct-color-bg)',
    surface: 'var(--wlct-color-surface)',
    surfaceRaised: 'var(--wlct-color-surface-raised)',
    border: 'var(--wlct-color-border)',
    text: 'var(--wlct-color-text)',
    textMuted: 'var(--wlct-color-text-muted)',
    primary: 'var(--wlct-color-primary)',
    primaryContrast: 'var(--wlct-color-primary-contrast)',
    success: 'var(--wlct-color-success)',
    warning: 'var(--wlct-color-warning)',
    danger: 'var(--wlct-color-danger)',
  },
  radius: {
    sm: 'var(--wlct-radius-sm)',
    md: 'var(--wlct-radius-md)',
    lg: 'var(--wlct-radius-lg)',
  },
  space: (units: number): string => `${units * 4}px`,
} as const;

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Maps API status enums onto a visual tone. Unknown values stay neutral. */
export function toneForStatus(status: string): StatusTone {
  const upper = status.toUpperCase();

  if (['ACTIVE', 'TRIALING', 'VERIFIED', 'APPROVED', 'OK', 'ENABLED'].includes(upper)) {
    return 'success';
  }
  if (['PENDING', 'PENDING_VERIFICATION', 'PAST_DUE', 'IN_REVIEW', 'TRIAL'].includes(upper)) {
    return 'warning';
  }
  if (['SUSPENDED', 'CANCELLED', 'CANCELED', 'REJECTED', 'LOCKED', 'ARCHIVED', 'FAILED', 'CRITICAL'].includes(upper)) {
    return 'danger';
  }
  if (['PROVISIONING', 'INVITED', 'INFO'].includes(upper)) {
    return 'info';
  }

  return 'neutral';
}

/**
 * Builds a CSS custom-property override block from tenant branding.
 * Values are validated as hex colours before use: branding is tenant-supplied
 * input and must never be injected into a style attribute unchecked.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function brandingCssVariables(branding: {
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}): Record<string, string> {
  const variables: Record<string, string> = {};

  if (branding.primaryColor && HEX_COLOR.test(branding.primaryColor)) {
    variables['--wlct-color-primary'] = branding.primaryColor;
  }
  if (branding.secondaryColor && HEX_COLOR.test(branding.secondaryColor)) {
    variables['--wlct-color-surface-raised'] = branding.secondaryColor;
  }
  if (branding.accentColor && HEX_COLOR.test(branding.accentColor)) {
    variables['--wlct-color-success'] = branding.accentColor;
  }

  return variables;
}

'use client';

import { useEffect } from 'react';
import { useTenant } from './tenant-context';

/**
 * Applies tenant branding, logo, colors, typography, favicon, and safe CSS
 * from backend-sanitized branding configuration.
 * Does not allow arbitrary backend HTML/CSS to execute unsafely.
 */

function sanitizeCssValue(value: string): string {
  // Only allow safe CSS values: hex colors, rgb, hsl, and safe font families
  // Reject javascript:, expression(), etc.
  const unsafePatterns = [/javascript:/i, /expression\(/i, /<script/i, /url\(/i, /@import/i];
  for (const pattern of unsafePatterns) {
    if (pattern.test(value)) {
      return '';
    }
  }
  return value;
}

function sanitizeColor(color?: string): string {
  if (!color) return '';
  // Allow hex, rgb, hsl, and CSS variables
  const colorRegex = /^(#[0-9a-fA-F]{3,8}|rgb\(.*\)|rgba\(.*\)|hsl\(.*\)|hsla\(.*\)|var\(--.*\))$/;
  if (colorRegex.test(color.trim())) {
    return sanitizeCssValue(color);
  }
  return '';
}

export function TenantBrandingProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { tenant } = useTenant();

  useEffect(() => {
    if (!tenant?.branding) return;

    const branding = tenant.branding;
    const root = document.documentElement;

    // Apply safe CSS variables from backend-sanitized values only
    if (branding.primaryColor) {
      const safe = sanitizeColor(branding.primaryColor);
      if (safe) root.style.setProperty('--brand-primary', safe);
    }
    if (branding.secondaryColor) {
      const safe = sanitizeColor(branding.secondaryColor);
      if (safe) root.style.setProperty('--brand-secondary', safe);
    }
    if (branding.accentColor) {
      const safe = sanitizeColor(branding.accentColor);
      if (safe) root.style.setProperty('--brand-accent', safe);
    }
    if (branding.backgroundColor) {
      const safe = sanitizeColor(branding.backgroundColor);
      if (safe) root.style.setProperty('--brand-background', safe);
    }
    if (branding.textColor) {
      const safe = sanitizeColor(branding.textColor);
      if (safe) root.style.setProperty('--brand-text', safe);
    }
    if (branding.fontFamily) {
      const safe = sanitizeCssValue(branding.fontFamily);
      if (safe) root.style.setProperty('--brand-font', safe);
    }

    // Apply favicon if provided and safe (https only)
    if (branding.faviconUrl && branding.faviconUrl.startsWith('https://')) {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.faviconUrl;
    }

    // Apply custom CSS only if backend-sanitized (we trust backend sanitization but still validate)
    if (branding.customCss) {
      // Backend should already sanitize, but we double-check for unsafe patterns
      const unsafe = /javascript:|expression\(|<script|@import.*http/i.test(branding.customCss);
      if (!unsafe) {
        let styleEl = document.getElementById('tenant-branding-css') as HTMLStyleElement;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'tenant-branding-css';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = branding.customCss;
      }
    }

    // Update title if appName provided
    if (branding.appName) {
      document.title = branding.appName;
    }

    return () => {
      // Cleanup is minimal to avoid flash, but remove custom CSS on tenant change
      const styleEl = document.getElementById('tenant-branding-css');
      if (styleEl) styleEl.remove();
    };
  }, [tenant?.branding]);

  return <>{children}</>;
}

export function TenantLogo({ className, fallback }: { className?: string; fallback?: React.ReactNode }): JSX.Element {
  const { tenant } = useTenant();
  const logoUrl = tenant?.branding?.logoUrl;

  if (logoUrl && logoUrl.startsWith('https://')) {
    return <img src={logoUrl} alt={`${tenant?.name ?? 'Tenant'} logo`} className={className} />;
  }

  return (fallback as JSX.Element) ?? <div className={className}>{tenant?.name?.charAt(0) ?? 'T'}</div>;
}

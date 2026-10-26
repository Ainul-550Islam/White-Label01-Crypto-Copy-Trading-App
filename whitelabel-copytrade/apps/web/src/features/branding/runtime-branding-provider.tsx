// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
'use client';
// # Responsibility: applies safe tenant branding tokens from the host-resolved public configuration.
import { useEffect, type ReactNode } from 'react';
import { tenantApi } from '@/api/tenant-api';

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT = /^[a-zA-Z0-9 ,'-]{1,80}$/;
export function RuntimeBrandingProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let mounted = true;
    tenantApi.getBranding().then((brand) => {
      if (!mounted) return;
      const root = document.documentElement;
      const values: Array<[string, string | undefined]> = [
        ['--brand-primary', brand.primaryColor], ['--brand-secondary', brand.secondaryColor],
        ['--brand-accent', brand.accentColor], ['--brand-background', brand.backgroundColor], ['--brand-text', brand.textColor],
      ];
      for (const [name, value] of values) if (value && COLOR.test(value)) root.style.setProperty(name, value);
      if (brand.fontFamily && FONT.test(brand.fontFamily)) root.style.setProperty('--brand-font', brand.fontFamily);
      if (brand.faviconUrl) {
        try { const url = new URL(brand.faviconUrl, window.location.origin); if (url.protocol === 'https:' || url.origin === window.location.origin) { let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); } link.href = url.toString(); } } catch { /* ignore unsafe tenant URL */ }
      }
    }).catch(() => { /* public branding is optional; use bundled theme */ });
    return () => { mounted = false; };
  }, []);
  return <>{children}</>;
}

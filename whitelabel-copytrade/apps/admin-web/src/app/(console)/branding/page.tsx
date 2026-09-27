import type { Metadata } from 'next';

import { Card, ErrorNotice, PageHeader } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Branding' };

interface Branding {
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  themeMode: 'light' | 'dark' | 'system';
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  socialLinks: Record<string, string>;
  updatedAt: string;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function Swatch({ label, value }: { label: string; value: string }): JSX.Element {
  // Tenant-supplied colours are validated before they reach a style attribute.
  const safe = HEX_COLOR.test(value) ? value : 'transparent';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
      <span
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.sm,
          background: safe,
          border: `1px solid ${theme.color.border}`,
          display: 'inline-block',
        }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
        <code style={{ fontSize: 12, color: theme.color.textMuted }}>{value}</code>
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 12, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, marginTop: 4, wordBreak: 'break-all' }}>{value ?? '—'}</div>
    </div>
  );
}

export default async function BrandingPage(): Promise<JSX.Element> {
  let branding: Branding | null = null;
  let error: string | null = null;

  try {
    branding = await serverFetch<Branding>('/tenants/current/branding');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Branding could not be loaded.';
  }

  return (
    <>
      <PageHeader
        title="Branding"
        description="Drives the mobile app, the customer-facing web surfaces and transactional email. Colours are validated as hex values server-side before they are ever rendered or emailed."
      />

      {error || !branding ? (
        <ErrorNotice title="Unable to load branding" message={error ?? 'No branding configured.'} />
      ) : (
        <div style={{ display: 'grid', gap: theme.space(5) }}>
          <Card title="Identity" description={`Last updated ${formatDateTime(branding.updatedAt)}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.space(4) }}>
              <Field label="App name" value={branding.appName} />
              <Field label="Theme mode" value={branding.themeMode} />
              <Field label="Font family" value={branding.fontFamily} />
              <Field label="Logo" value={branding.logoUrl} />
              <Field label="Dark logo" value={branding.logoDarkUrl} />
              <Field label="Favicon" value={branding.faviconUrl} />
            </div>
          </Card>

          <Card title="Palette" description="Applied as CSS custom properties at render time.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.space(4) }}>
              <Swatch label="Primary" value={branding.primaryColor} />
              <Swatch label="Secondary" value={branding.secondaryColor} />
              <Swatch label="Accent" value={branding.accentColor} />
              <Swatch label="Background" value={branding.backgroundColor} />
              <Swatch label="Text" value={branding.textColor} />
            </div>
          </Card>

          <Card title="Support & legal links">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: theme.space(4) }}>
              <Field label="Support email" value={branding.supportEmail} />
              <Field label="Support URL" value={branding.supportUrl} />
              <Field label="Terms" value={branding.termsUrl} />
              <Field label="Privacy" value={branding.privacyUrl} />
            </div>

            {Object.keys(branding.socialLinks).length > 0 && (
              <div style={{ marginTop: theme.space(4) }}>
                <div style={{ fontSize: 12, color: theme.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Social
                </div>
                <ul style={{ margin: `${theme.space(2)} 0 0`, paddingLeft: 18, fontSize: 13 }}>
                  {Object.entries(branding.socialLinks).map(([network, url]) => (
                    <li key={network}>
                      {network}: <span style={{ wordBreak: 'break-all' }}>{url}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Editing branding">
            <p style={{ margin: 0, fontSize: 14, color: theme.color.textMuted }}>
              Send a <code>PATCH /v1/tenants/current/branding</code> with the fields you want to
              change. The endpoint requires the <code>tenant:manage</code> permission and every
              change is written to the audit log. An in-console editor lands with the branding work
              in Part 3.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}

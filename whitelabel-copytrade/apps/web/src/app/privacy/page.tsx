'use client';

import Link from 'next/link';
import { PageContainer } from '@/layout/page-container';
import { useTenant } from '@/tenant/tenant-context';

export default function PrivacyPage(): JSX.Element {
  const { tenant } = useTenant();
  const brandName = tenant?.branding?.appName ?? tenant?.name ?? 'Copy Trading Platform';
  const supportEmail = tenant?.branding?.supportEmail;
  const externalPrivacyUrl = tenant?.branding?.privacyUrl;

  return (
    <PageContainer
      title="Privacy Policy & Data Governance"
      description={`How ${brandName} collects, isolates, encrypts, retains, and governs personal and operational data`}
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/" className="rounded border px-3 py-1.5 hover:bg-accent">
            Home
          </Link>
          <Link href="/terms" className="rounded border px-3 py-1.5 hover:bg-accent">
            Terms of Service
          </Link>
          <Link href="/login" className="rounded bg-primary px-3 py-1.5 text-white">
            Sign In
          </Link>
        </div>
      }
    >
      <div className="space-y-6 text-sm leading-relaxed">
        {externalPrivacyUrl && (
          <div className="rounded border bg-gray-50 p-4 text-xs">
            <span className="font-medium">Organisation privacy addendum: </span>
            <a
              href={externalPrivacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {externalPrivacyUrl}
            </a>
          </div>
        )}

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">1. Multi-Tenant Isolation &amp; Controller Scope</h2>
          <p className="text-muted">
            {brandName} operates on a strictly isolated multi-tenant architecture. Every customer profile, exchange
            connection, subscription, portfolio statement, and audit event is bound to your organisation&apos;s
            tenant identifier derived from the verified server-side session or domain host. PostgreSQL Row-Level
            Security (RLS) and application-layer tenant predicates prevent cross-tenant data access.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">2. Categories of Data Processed</h2>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>
              <strong className="text-foreground">Identity &amp; Account Profile:</strong> Email address, display
              name, legal name, phone number (E.164), country/jurisdiction code, preferred locale, and currency.
            </li>
            <li>
              <strong className="text-foreground">Authentication &amp; Device Security:</strong> Argon2id password
              hashes, TOTP two-factor metadata, hashed recovery codes, OIDC/SAML Single Sign-On assertions, device
              fingerprints, and active session records.
            </li>
            <li>
              <strong className="text-foreground">Exchange Connectivity Metadata:</strong> Trade-only exchange API
              credentials are encrypted at rest using AES-256-GCM envelope encryption with tenant-bound Additional
              Authenticated Data (AAD) or stored in a dedicated secrets manager (HashiCorp Vault KV v2 / AWS Secrets
              Manager). Plaintext credentials are never logged or returned to any client.
            </li>
            <li>
              <strong className="text-foreground">Trading, Portfolio &amp; Accounting Records:</strong> Copy-trading
              subscriptions, order intents, execution fills, daily equity snapshots, realized/unrealized PnL, and
              finalized period statements required for financial reconciliation.
            </li>
            <li>
              <strong className="text-foreground">Audit &amp; Telemetry Logs:</strong> Append-only security and
              operational audit logs record privileged actions with SHA-256 hashed IP addresses and correlation IDs.
              Client-side telemetry automatically redacts tokens, credentials, and personal identifiers before
              transmission.
            </li>
          </ul>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">3. Cookies &amp; Session Storage</h2>
          <p className="text-muted">
            The web application uses strictly necessary <code className="font-mono text-xs">httpOnly</code> cookies
            (<code className="font-mono text-xs">wlct_at</code>, <code className="font-mono text-xs">wlct_rt</code>,{' '}
            <code className="font-mono text-xs">wlct_did</code>, and{' '}
            <code className="font-mono text-xs">wlct_csrf</code>) to maintain authenticated sessions, bind refresh
            token rotation to your device, and enforce Cross-Site Request Forgery (CSRF) protection on mutating
            requests. Browser <code className="font-mono text-xs">localStorage</code> is restricted to non-sensitive
            UI preferences and is cleared upon sign-out.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">4. Retention Policies &amp; Legal Hold Precedence</h2>
          <p className="text-muted">
            Data retention is governed by jurisdiction-aware retention policies configured in the platform&apos;s
            Governance module. Regulated financial records, finalized accounting statements, compliance cases, and
            append-only security audit trails are retained for the statutory period applicable to your jurisdiction.
            When an active Legal Hold applies to an account or record set, automated retention purging and deletion
            workflows are suspended until the hold is formally released by an authorized compliance reviewer.
          </p>
        </section>

        <section className="rounded border bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">5. Data Subject Rights (Access, Export &amp; Deletion)</h2>
          <p className="text-muted">
            Subject to identity verification, regulatory retention obligations, and active legal holds, you may
            request:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-muted">
            <li>
              <strong className="text-foreground">Data Discovery &amp; Export:</strong> A deterministic,
              cryptographically hashed inventory and export of your personal and account data held within your
              organisation&apos;s tenant scope.
            </li>
            <li>
              <strong className="text-foreground">Profile Rectification:</strong> Direct updates to your display
              name, contact details, locale, and notification preferences via{' '}
              <Link href="/account/profile" className="text-primary underline">
                Account Profile
              </Link>
              .
            </li>
            <li>
              <strong className="text-foreground">Erasure / Deletion Check:</strong> Evaluation and execution of
              personal data deletion where no regulatory, financial reconciliation, or legal-hold blocker applies.
            </li>
          </ul>
          {supportEmail && (
            <p className="pt-2 text-xs text-muted">
              For privacy inquiries or to submit a verified data subject request, contact your organisation at{' '}
              <a href={`mailto:${supportEmail}`} className="text-primary underline">
                {supportEmail}
              </a>
              .
            </p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

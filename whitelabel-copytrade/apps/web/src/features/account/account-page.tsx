"use client";
import type { JSX } from 'react';

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { useAuth } from "@/auth/auth.store";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

const ACCOUNT_SECTIONS = [
  {
    title: "Profile & Password",
    href: "/account/profile",
    description: "Update display name, phone, regional locale, and account password.",
  },
  {
    title: "Onboarding Workflow",
    href: "/onboarding",
    description: "Inspect or initiate your client-lifecycle onboarding steps and blockers.",
  },
  {
    title: "Authorized Relationships",
    href: "/account/relationships",
    description: "Review trader, follower, and strategy relationships within your tenant.",
  },
  {
    title: "Account Restrictions",
    href: "/account/restrictions",
    description: "Inspect active compliance or risk restrictions on your accounts.",
  },
];

/** The caller's accounts (there is no accounts/current route; the list is scoped to the caller). */
export function AccountPage(): JSX.Element {
  const { session } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "institutional"],
    queryFn: () => clientLifecycleApi.listAccounts(),
  });
  const accounts = data ?? [];
  return (
    <PageContainer
      title="Account Center"
      description="Institutional trading accounts, profile settings, relationships, and restrictions"
      actions={
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/account/profile" className="rounded bg-primary px-3 py-1.5 text-white">
            Edit Profile &amp; Password
          </Link>
          <Link href="/security" className="rounded border px-3 py-1.5 hover:bg-accent">
            Security &amp; MFA
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="rounded border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{session?.user.displayName ?? session?.user.email}</p>
              <p className="text-xs text-muted">
                {session?.user.email} · Organisation: {session?.tenant.name} · Roles:{" "}
                {session?.user.roles.join(", ")}
              </p>
            </div>
            <StatusBadge status={session?.user.status ?? "ACTIVE"} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACCOUNT_SECTIONS.map((sec) => (
            <Link
              key={sec.href}
              href={sec.href}
              className="rounded border bg-card p-4 hover:shadow transition-shadow"
            >
              <h3 className="text-sm font-semibold text-primary">{sec.title}</h3>
              <p className="mt-1 text-xs text-muted">{sec.description}</p>
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold">Institutional &amp; Trading Accounts</h2>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : accounts.length === 0 ? (
            <EmptyState
              title="No account yet"
              description="Your account appears here once onboarding opens it."
              action={{ label: "Go to Onboarding", href: "/onboarding" }}
            />
          ) : (
            <div className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="space-y-2 rounded border bg-card p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <span className="font-medium">{a.displayName}</span>{" "}
                      <span className="text-xs text-muted">({a.accountType.toLowerCase()})</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={a.state} />
                      {a.complianceStatus && <StatusBadge status={a.complianceStatus} />}
                      {a.riskStatus && <StatusBadge status={a.riskStatus} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

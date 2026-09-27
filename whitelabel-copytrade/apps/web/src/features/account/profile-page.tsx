'use client';
import { useAuth } from '@/auth/auth.store';
import { PageContainer } from '@/layout/page-container';
export function ProfilePage(): JSX.Element {
  const { session } = useAuth();
  return (
    <PageContainer title="Profile" description="Customer profile from backend">
      <div className="rounded border bg-card p-4">
        <p className="text-sm">Email: {session?.user.email}</p>
        <p className="text-sm">Display Name: {session?.user.displayName ?? 'Not set'}</p>
        <p className="text-sm">Tenant: {session?.tenant.name}</p>
        <p className="text-sm">Roles: {session?.user.roles.join(', ')}</p>
      </div>
    </PageContainer>
  );
}

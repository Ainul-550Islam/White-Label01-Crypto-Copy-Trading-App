import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { LandingPage } from '@/features/landing/landing-page';

export const dynamic = 'force-dynamic';

export default function IndexPage(): JSX.Element {
  const cookieStore = cookies();
  const hasSession =
    cookieStore.get('wlct_session') ||
    cookieStore.get('wlct_at') ||
    cookieStore.get('access_token');

  // Tenant resolution is backend-authoritative, not from query param.
  // Authenticated sessions proceed directly to the customer dashboard;
  // unauthenticated visitors see the tenant-branded public business site.
  if (hasSession) {
    redirect('/dashboard');
  }
  return <LandingPage />;
}

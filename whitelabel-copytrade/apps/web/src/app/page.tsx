import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default function IndexPage(): JSX.Element {
  const cookieStore = cookies();
  const hasSession = cookieStore.get('wlct_session') || cookieStore.get('access_token');
  
  // Tenant resolution is backend-authoritative, not from query param
  // Landing page checks authenticated context
  if (hasSession) {
    redirect('/dashboard');
  }
  redirect('/login');
}

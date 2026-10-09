import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The root path is a router: signed-in users land on the overview. */
export default async function IndexPage(): Promise<never> {
  if (await getAccessToken()) {
    redirect('/dashboard');
  }

  redirect('/login');
}

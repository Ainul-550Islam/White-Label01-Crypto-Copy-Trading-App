import type { Metadata } from 'next';
import ConsentPage from '@/features/oauth/consent-page';
export const metadata: Metadata = { title: 'Application authorization', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default ConsentPage;

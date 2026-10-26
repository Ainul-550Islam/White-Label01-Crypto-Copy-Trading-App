// # Responsibility: server-renders the effective public fee schedule with canonical page metadata.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { serverFetch } from '@/lib/server-api';
import { FeeSchedulePage } from '@/features/billing/fee-schedule-page';

export const metadata: Metadata = { title: 'Fees and pricing', description: 'Published effective-dated platform fee rates and version history.', alternates: { canonical: '/fees' }, openGraph: { title: 'Fees and pricing', description: 'Published effective-dated platform fee rates.' } };
export const revalidate = 60;
type Version={version:number;effectiveFrom:string;effectiveUntil:string|null;managementFeeRate:string;profitShareRate:string;currency:string};
type Schedule=Version & {source:'tenant_override'|'platform_default';versions:Version[]};
export default async function FeesPage(){let initial:Schedule|null=null;try{const host=(await headers()).get('host')??undefined;initial=await serverFetch<Schedule>('/public/fee-schedule',{authenticated:false,revalidate:60,host});}catch{/* client can retry and show an explicit unavailable state */}return <FeeSchedulePage initialSchedule={initial}/>;}

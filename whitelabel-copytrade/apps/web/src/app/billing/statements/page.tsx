// # Responsibility: mounts the authenticated immutable profit-share statement list and detail view.
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { ProfitShareStatementPage } from '@/features/billing/profit-share-statement-page';
export default function Page(){return <AuthGuard><AppShell><ProfitShareStatementPage/></AppShell></AuthGuard>;}

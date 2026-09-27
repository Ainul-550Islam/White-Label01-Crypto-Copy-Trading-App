'use client';
import { PageContainer } from '@/layout/page-container';
import { NotificationCenter } from '@/components/notification-center';
export function NotificationsPage(): JSX.Element {
  return (
    <PageContainer title="Notifications" description="Full customer notification inbox from backend">
      <NotificationCenter />
    </PageContainer>
  );
}

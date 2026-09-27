'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ProfilePage } from '@/features/account/profile-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ProfilePage /></AppShell></AuthGuard>;
}

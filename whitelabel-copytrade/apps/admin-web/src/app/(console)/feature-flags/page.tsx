// # Responsibility: mounts the tenant-scoped feature-flag administration surface.
import { TenantFeatureFlags } from '@/features/settings/tenant-feature-flags';
export default function Page() { return <TenantFeatureFlags />; }

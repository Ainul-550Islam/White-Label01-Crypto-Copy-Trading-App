type StatusVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
}

function getVariantForStatus(status: string): StatusVariant {
  const normalized = status.toUpperCase();
  if (['ACTIVE', 'CONFIRMED', 'COMPLETED', 'FILLED', 'HEALTHY', 'VERIFIED', 'APPROVED', 'SETTLED', 'VALID'].includes(normalized)) {
    return 'success';
  }
  if (['PENDING', 'REQUESTED', 'UNDER_REVIEW', 'SUBMITTED', 'CONFIRMING', 'QUEUED', 'IN_PROGRESS', 'STARTING', 'RUNNING'].includes(normalized)) {
    return 'warning';
  }
  if (['FAILED', 'REJECTED', 'BLOCKED', 'SUSPENDED', 'LOCKED', 'ERROR', 'CRITICAL', 'UNHEALTHY'].includes(normalized)) {
    return 'danger';
  }
  if (['DEGRADED', 'WARNING', 'STALE', 'MISSING_PRICE', 'MISSING_FX', 'INCOMPLETE', 'REVIEW_REQUIRED'].includes(normalized)) {
    return 'warning';
  }
  if (['INFO', 'DRAFT', 'NOT_STARTED'].includes(normalized)) {
    return 'info';
  }
  return 'neutral';
}

function getColorClasses(variant: StatusVariant): string {
  switch (variant) {
    case 'success':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'danger':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'info':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'neutral':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export function StatusBadge({ status, variant, className }: StatusBadgeProps): JSX.Element {
  const resolvedVariant = variant ?? getVariantForStatus(status);
  const colorClasses = getColorClasses(resolvedVariant);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClasses} ${className ?? ''}`}
      aria-label={`Status: ${status}`}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function FundingStatusBadge({ state }: { state: string }): JSX.Element {
  const labelMap: Record<string, string> = {
    REQUESTED: 'Requested',
    UNDER_REVIEW: 'Under Review',
    APPROVED: 'Approved',
    SUBMITTED: 'Submitted',
    CONFIRMING: 'Confirming',
    CONFIRMED: 'Confirmed',
    FAILED: 'Failed',
    REVERSED: 'Reversed',
    CANCELLED: 'Cancelled',
    EXPECTED: 'Expected',
    OBSERVED: 'Observed',
    REORGED: 'Reorged',
    REJECTED: 'Rejected',
  };

  return <StatusBadge status={labelMap[state] ?? state} />;
}

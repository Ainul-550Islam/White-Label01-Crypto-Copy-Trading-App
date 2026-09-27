export function LoadingState({ message = 'Loading...' }: { message?: string }): JSX.Element {
  return (
    <div className="flex min-h-[200px] items-center justify-center p-8" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="mt-3 text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

export function InlineLoading({ message }: { message?: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      {message ?? 'Loading...'}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? 'h-4 w-full'}`} aria-hidden />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

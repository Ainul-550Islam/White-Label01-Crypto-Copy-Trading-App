'use client';

import { ApiError } from '@/api/api-errors';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps): JSX.Element {
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError ? apiError.getUserMessage() : (error as Error)?.message ?? 'An unexpected error occurred';
  const isMaintenance = apiError?.isMaintenance();
  const isForbidden = apiError?.isForbidden();

  return (
    <div className="flex min-h-[200px] items-center justify-center p-8" role="alert">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 text-4xl" aria-hidden>
          {isMaintenance ? '🚧' : isForbidden ? '🔒' : '⚠️'}
        </div>
        <h3 className="text-lg font-semibold">{title ?? (isMaintenance ? 'Under Maintenance' : 'Something went wrong')}</h3>
        <p className="mt-2 text-sm text-muted">{message}</p>
        {apiError?.correlationId && (
          <p className="mt-2 text-xs text-muted">Ref: {apiError.correlationId.slice(0, 8)}</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          {onRetry && (
            <button onClick={onRetry} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
              Try Again
            </button>
          )}
          <button onClick={() => window.location.reload()} className="rounded border px-4 py-2 text-sm">
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
      <div className="flex items-center justify-between">
        <span>{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="ml-2 text-xs font-medium underline">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

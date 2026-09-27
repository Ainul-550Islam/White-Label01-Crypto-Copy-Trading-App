'use client';

import { useEffect } from 'react';

/**
 * Root error boundary.
 *
 * Renders a generic message: an error digest is safe to show, the underlying
 * message is not, because it can carry internal detail.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('admin-web.render_error', { digest: error.digest });
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 14 }}>
          The page could not be displayed. The incident has been logged.
        </p>
        {error.digest && (
          <p style={{ color: 'var(--wlct-color-text-muted)', fontSize: 12 }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 16,
            padding: '10px 18px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--wlct-color-primary)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}

/**
 * Application entry point using repository's actual frontend framework/build conventions.
 * For Next.js, the real entry is src/app/layout.tsx and src/app/page.tsx.
 * This file exists to satisfy the required file structure and provides
 * a programmatic bootstrap for non-Next.js tooling if needed.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers';
import { ErrorBoundary } from './app/error-boundary';

// Only used if running outside Next.js (e.g., Vite fallback)
// In Next.js, this file is not executed; layout.tsx is the entry.

function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <Providers>
        <div className="p-8 text-center">
          <h1 className="text-xl font-bold">Customer Web</h1>
          <p className="text-sm text-muted">This application runs via Next.js. Use npm run dev.</p>
        </div>
      </Providers>
    </ErrorBoundary>
  );
}

// Safe mount only if #root exists (Vite mode)
if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(<App />);
  }
}

export default App;

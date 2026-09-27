'use client';
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  correlationId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, correlationId: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const correlationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    return { hasError: true, error, correlationId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Safe diagnostics without leaking secrets
    const safeError = {
      message: error.message.slice(0, 200),
      correlationId: this.state.correlationId,
      componentStack: errorInfo.componentStack?.slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    // In production, would send to error reporting service with scrubbing
    console.error('ErrorBoundary caught:', safeError);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-2 text-sm text-muted">An unexpected error occurred. Please try reloading the page.</p>
            <p className="mt-2 text-xs text-muted">Ref: {this.state.correlationId.slice(0, 8)}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => this.setState({ hasError: false, error: null, correlationId: '' })} className="rounded bg-primary px-4 py-2 text-sm text-white">Try Again</button>
              <button onClick={() => window.location.reload()} className="rounded border px-4 py-2 text-sm">Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

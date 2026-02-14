'use client';

import React from 'react';

type ErrorBoundaryRenderProps = {
  error: Error;
  reset: () => void;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  fallbackRender?: (props: ErrorBoundaryRenderProps) => React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  private reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const error = this.state.error || new Error('Unknown error');
    if (this.props.fallbackRender) return this.props.fallbackRender({ error, reset: this.reset });
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="rounded-lg border border-border/30 bg-muted/10 p-4 text-sm">
        <div className="font-medium text-foreground">Something went wrong.</div>
        <div className="mt-1 text-xs text-muted-foreground">{error.message}</div>
        <button
          type="button"
          onClick={this.reset}
          className="mt-3 inline-flex items-center rounded-md border border-border/40 bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted/30 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }
}


import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-card" role="alert" aria-live="assertive">
          <div className="error-boundary-icon" aria-hidden="true">⚠️</div>
          <h2>{this.props.fallbackTitle ?? 'Something went wrong in this view'}</h2>
          <p className="error-boundary-message muted">
            {this.state.error?.message || 'An unexpected error occurred while rendering.'}
          </p>
          <div className="error-boundary-actions">
            <button className="btn btn--primary" onClick={this.handleReset}>
              Try again
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Reload application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

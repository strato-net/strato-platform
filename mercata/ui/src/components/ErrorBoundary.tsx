import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Check if this is a known wallet conflict error that we can ignore
    const errorMessage = error?.message || '';
    const isWalletConflict = 
      errorMessage.includes('Cannot redefine property: ethereum') ||
      errorMessage.includes('Cannot set property ethereum') ||
      errorMessage.includes('already has ethereum defined');
    
    if (isWalletConflict) {
      console.warn('Wallet extension conflict detected but handled gracefully');
      // Reset the error state for wallet conflicts
      this.setState({ hasError: false });
      return;
    }
    
    console.error('Wallet provider error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center p-6 max-w-md">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Wallet Connection Issue
            </h2>
            <p className="text-muted-foreground mb-4">
              There was an issue connecting to your wallet. This usually happens when multiple wallet extensions are installed.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Please try:
            </p>
            <ul className="text-sm text-muted-foreground text-left mb-4 space-y-1">
              <li>• Refreshing the page</li>
              <li>• Disabling other wallet extensions temporarily</li>
              <li>• Using a different browser or incognito mode</li>
            </ul>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
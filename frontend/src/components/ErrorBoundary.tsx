import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[400px] text-center space-y-6 bg-red-500/5 rounded-md border border-red-500/10 backdrop-blur-sm">
          <div className="h-16 w-16 rounded-md bg-red-500/10 flex items-center justify-center mx-auto">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight text-foreground">Something went wrong</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              The AI component encountered an unexpected issue while processing.
            </p>
          </div>
          
          {process.env.NODE_ENV === 'development' && (
            <div className="text-[10px] font-mono p-4 bg-zinc-950/50 rounded-md border border-red-500/20 text-red-400 overflow-auto max-w-full text-left">
              {this.state.error?.toString()}
            </div>
          )}

          <Button 
            variant="outline" 
            size="sm" 
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reload Component
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

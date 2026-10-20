import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home, Ghost } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    // Auto-reload on dynamic import / chunk load failures (often caused by deployments)
    const isChunkError = error && (
      error.message?.includes("dynamically imported module") ||
      error.message?.includes("Importing a module script failed") ||
      error.message?.includes("ChunkLoadError") ||
      error.message?.includes("Loading chunk") ||
      error.name === "ChunkLoadError"
    );

    if (isChunkError) {
      const lastReload = sessionStorage.getItem("chunk-error-reload-ts");
      const now = Date.now();
      // Allow reloading at most once every 10 seconds to prevent infinite reload loops
      if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem("chunk-error-reload-ts", now.toString());
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("r", Date.now().toString());
          window.location.href = url.toString();
        } catch (_) {
          window.location.reload();
        }
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
          <div className="max-w-2xl w-full text-center space-y-12">
            {/* Visual Indicator */}
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-primary/20 blur-[80px] rounded-full animate-pulse" />
              <div className="relative h-32 w-32 mx-auto rounded-[2.5rem] bg-card border-8 border-background shadow-2xl flex items-center justify-center text-primary transform rotate-12 hover:rotate-0 transition-transform duration-500">
                <Ghost className="h-16 w-16" />
              </div>
            </div>

            {/* Error Message */}
            <div className="space-y-4">
              <h1 className="text-display text-5xl md:text-6xl font-black tracking-tighter leading-none italic uppercase">
                Something <span className="text-primary italic">Went Cold</span>
              </h1>
              <p className="text-xl text-muted-foreground font-bold max-w-lg mx-auto leading-relaxed">
                Oops! Looks like we hit a small bump in the kitchen. Don't worry, your data is safe.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <Button 
                onClick={() => window.location.reload()}
                size="lg"
                className="h-16 px-10 rounded-2xl bg-primary text-slate-950 font-black text-sm uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
              >
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Try Again
                </div>
              </Button>
              <Button 
                onClick={this.handleReset}
                variant="outline"
                size="lg"
                className="h-16 px-10 rounded-2xl font-black text-sm uppercase tracking-widest border-2 hover:bg-muted transition-all"
              >
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Go Home
                </div>
              </Button>
            </div>

            {/* Debug Info (Only in development) */}
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-12 p-8 rounded-[2rem] bg-muted/30 border border-border/40 text-left overflow-auto max-h-60">
                <div className="flex items-center gap-2 text-destructive mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-black text-xs uppercase tracking-widest">Error Details</span>
                </div>
                <pre className="font-mono text-xs opacity-60 leading-relaxed font-bold">
                  {this.state.error?.message}
                  {"\n"}
                  {this.state.error?.stack}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

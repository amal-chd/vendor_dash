import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, Home, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AdminErrorBoundary extends Component<Props, State> {
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

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center bg-muted/10">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-500/10 mb-6">
            <AlertTriangle className="h-10 w-10 text-rose-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground max-w-[500px] mb-8">
            An unexpected error occurred in the admin panel.
            {this.state.error?.message && (
              <span className="block mt-2 font-medium">{this.state.error.message}</span>
            )}
          </p>
          
          <div className="flex items-center gap-4">
            <Button onClick={() => window.location.reload()} variant="default" className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Reload Page
            </Button>
            <Button onClick={() => window.location.href = "/admin"} variant="outline" className="gap-2">
              <Home className="h-4 w-4" />
              Go to Dashboard
            </Button>
          </div>

          {process.env.NODE_ENV === "development" && this.state.error && (
            <div className="mt-12 text-left bg-card border border-border/50 rounded-xl p-4 max-w-full overflow-auto">
              <p className="text-xs font-semibold text-rose-500 mb-2">Stack Trace (Dev Only)</p>
              <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

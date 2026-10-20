import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Globe, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function GlobalBlocker({ children, moduleName }: { children: React.ReactNode; moduleName: string }) {
  const { restaurantId } = useAuth();

  if (restaurantId === 'global') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 bg-card rounded-3xl border border-border/40 shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-6">
          <Globe className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black uppercase tracking-tight text-foreground mb-2">
          Global View Active
        </h2>
        <p className="text-muted-foreground font-medium max-w-md mb-8">
          You are currently viewing data across all your outlets. To manage {moduleName.toLowerCase()}, please select a specific outlet from the switcher in the sidebar.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

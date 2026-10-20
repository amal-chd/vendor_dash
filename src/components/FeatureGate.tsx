import React from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { Capability } from '@/constants/plans';
import { Button } from './ui/button';
import { Lock, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

interface FeatureGateProps {
  capability: Capability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showUpgrade?: boolean;
}

export function FeatureGate({ capability, children, fallback, showUpgrade = true }: FeatureGateProps) {
  const { hasCapability, loading } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (hasCapability(capability)) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/80 bg-card/60 backdrop-blur-xl p-8 md:p-12 text-center max-w-2xl mx-auto my-12 shadow-xl space-y-6">
      {/* Decorative gradients */}
      <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-violet-500/10 blur-3xl" />

      {/* Lock Icon and Glow */}
      <div className="relative mx-auto w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary/20 to-violet-500/20 flex items-center justify-center shadow-inner border border-primary/20 animate-pulse">
        <Lock className="w-10 h-10 text-primary" />
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-primary to-violet-500 opacity-20 blur-sm -z-10" />
      </div>

      <div className="space-y-3">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-foreground flex items-center justify-center gap-2">
          Premium Feature
          <Sparkles className="w-5 h-5 text-amber-500 fill-amber-500" />
        </h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed font-medium">
          This advanced module is not included in your current subscription plan. Upgrade to unlock this feature and supercharge your restaurant operations.
        </p>
      </div>

      {showUpgrade && (
        <div className="pt-4">
          <Button asChild size="lg" className="rounded-xl font-bold bg-gradient-to-r from-primary to-violet-600 hover:from-primary/90 hover:to-violet-600/90 text-white shadow-lg shadow-primary/20 px-8 h-12">
            <Link to="/dashboard/settings?tab=billing">
              Upgrade Subscription
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

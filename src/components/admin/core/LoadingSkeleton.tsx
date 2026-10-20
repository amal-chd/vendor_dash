import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface LoadingSkeletonProps {
  variant?: 'table' | '360' | 'dashboard' | 'form' | 'list';
  rows?: number;
  className?: string;
}

export function LoadingSkeleton({
  variant = 'list',
  rows = 5,
  className
}: LoadingSkeletonProps) {
  
  if (variant === 'table') {
    return (
      <div className={cn("w-full border rounded-lg overflow-hidden", className)}>
        <div className="h-12 border-b bg-muted/20 px-4 flex items-center gap-4">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="h-4 w-1/6" />
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-16 px-4 flex items-center gap-4 bg-card">
              <Skeleton className="h-4 w-8" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === '360') {
    return (
      <div className={cn("space-y-6 w-full", className)}>
        {/* Header */}
        <div className="flex items-start justify-between border-b pb-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        
        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border rounded-xl p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
        
        {/* Main content split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="border rounded-xl p-6 space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="border rounded-xl p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
          <div className="border rounded-xl p-6 space-y-4 h-fit">
            <Skeleton className="h-6 w-40" />
            <div className="space-y-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-4 w-4 rounded-full mt-1 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'dashboard') {
    return (
      <div className={cn("space-y-6 w-full", className)}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border rounded-xl p-5 space-y-4">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-[400px] rounded-xl border" />
          <Skeleton className="h-[400px] rounded-xl border" />
        </div>
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className={cn("space-y-6 max-w-2xl", className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-4">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    );
  }

  // default 'list'
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border rounded-lg bg-card">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-tab loading state: header, KPI row and table in the same shape as the
 * page that is coming. Replaces a lone centred spinner, which left the tab
 * blank and then jumped when content arrived.
 */
export function PageSkeleton({ kpis = 4, rows = 6 }: { kpis?: number; rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {kpis > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-[108px] rounded-2xl" />
          ))}
        </div>
      )}
      <LoadingSkeleton variant="table" rows={rows} />
    </div>
  );
}

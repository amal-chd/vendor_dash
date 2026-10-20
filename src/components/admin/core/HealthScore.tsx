import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScoreComponent {
  label: string;
  score: number;
  weight?: number;
  description?: string;
}

export interface HealthScoreProps {
  score: number;
  components?: ScoreComponent[];
  trend?: 'improving' | 'declining' | 'stable';
  compact?: boolean;
  className?: string;
}

export function HealthScore({
  score,
  components,
  trend,
  compact = false,
  className
}: HealthScoreProps) {
  const getScoreColor = (s: number) => {
    if (s >= 80) return "text-emerald-500";
    if (s >= 50) return "text-amber-500";
    return "text-rose-500";
  };

  const getBgColor = (s: number) => {
    if (s >= 80) return "bg-emerald-500";
    if (s >= 50) return "bg-amber-500";
    return "bg-rose-500";
  };

  const trendIcon = {
    improving: <TrendingUp className="w-4 h-4 text-emerald-500" />,
    declining: <TrendingDown className="w-4 h-4 text-rose-500" />,
    stable: <Minus className="w-4 h-4 text-muted-foreground" />
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 font-medium", className)}>
        <span className={cn(getScoreColor(score))}>{score}</span>
        {trend && <span className="opacity-80">{trendIcon[trend]}</span>}
      </div>
    );
  }

  // Calculate SVG circle properties
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center gap-6">
        <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
          {/* Background circle */}
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              className="text-secondary"
            />
            {/* Progress circle */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={cn("transition-all duration-1000 ease-out", getScoreColor(score))}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tracking-tighter">{score}</span>
            {trend && <div className="mt-0.5">{trendIcon[trend]}</div>}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-1">Overall Health</h4>
          <p className="text-xs text-muted-foreground">
            {score >= 80 ? "Excellent standing" : score >= 50 ? "Needs attention" : "Critical state"}
          </p>
        </div>
      </div>

      {components && components.length > 0 && (
        <div className="space-y-3">
          {components.map((comp, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-muted-foreground" title={comp.description}>
                  {comp.label}
                  {comp.weight && <span className="opacity-60 ml-1">({comp.weight}x)</span>}
                </span>
                <span className="font-semibold">{comp.score}</span>
              </div>
              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all duration-500", getBgColor(comp.score))}
                  style={{ width: `${comp.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

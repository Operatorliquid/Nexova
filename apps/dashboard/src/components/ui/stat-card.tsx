import type { LucideIcon } from 'lucide-react';
import { AnimatedCard } from './motion';

export type StatCardColor = 'emerald' | 'blue' | 'cyan' | 'amber' | 'red' | 'primary';

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color: StatCardColor;
  sub?: string;
  isLoading?: boolean;
}

const COLOR_MAP: Record<StatCardColor, {
  bg: string;
  text: string;
  gradient: string;
  stripe: string;
  glow: string;
}> = {
  emerald: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    gradient: 'text-gradient-emerald',
    stripe: 'from-emerald-400 to-emerald-400/0',
    glow: 'shadow-[0_0_12px_rgba(52,211,153,0.2)]',
  },
  blue: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    gradient: 'text-gradient-blue',
    stripe: 'from-blue-400 to-blue-400/0',
    glow: 'shadow-[0_0_12px_rgba(96,165,250,0.2)]',
  },
  cyan: {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    gradient: 'text-gradient-cyan',
    stripe: 'from-cyan-400 to-cyan-400/0',
    glow: 'shadow-[0_0_12px_rgba(34,211,238,0.2)]',
  },
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    gradient: 'text-gradient-amber',
    stripe: 'from-amber-400 to-amber-400/0',
    glow: 'shadow-[0_0_12px_rgba(251,191,36,0.2)]',
  },
  red: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    gradient: 'text-gradient-red',
    stripe: 'from-red-400 to-red-400/0',
    glow: 'shadow-[0_0_12px_rgba(248,113,113,0.2)]',
  },
  primary: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    gradient: 'text-gradient-primary',
    stripe: 'from-primary to-primary/0',
    glow: 'shadow-[0_0_12px_hsl(var(--primary)/0.2)]',
  },
};

export function StatCard({ label, value, icon: Icon, color, sub, isLoading }: StatCardProps) {
  const c = COLOR_MAP[color];

  if (isLoading) {
    return (
      <AnimatedCard className="!p-0 overflow-hidden">
        <div className="h-[3px] bg-gradient-to-r from-secondary to-transparent" />
        <div className="p-5 space-y-3">
          <div className="animate-pulse rounded-lg bg-secondary h-4 w-24" />
          <div className="animate-pulse rounded-lg bg-secondary h-7 w-32" />
        </div>
      </AnimatedCard>
    );
  }

  return (
    <AnimatedCard className="!p-0 overflow-hidden">
      <div className={`h-[3px] bg-gradient-to-r ${c.stripe}`} />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 text-gradient ${c.gradient}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-11 h-11 rounded-xl ${c.bg} ${c.glow} flex items-center justify-center flex-shrink-0 ml-3`}>
            <Icon className={`w-5 h-5 ${c.text}`} />
          </div>
        </div>
      </div>
    </AnimatedCard>
  );
}

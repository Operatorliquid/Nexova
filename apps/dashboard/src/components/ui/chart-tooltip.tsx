import type { ReactNode } from 'react';

/**
 * Glass-style tooltip wrapper for Nivo charts.
 */
export function ChartTooltip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
      {children}
    </div>
  );
}

export function TooltipLine({
  color,
  label,
  value,
  sub,
}: {
  color?: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {color && (
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-sm font-semibold text-foreground">{value}</span>
        </div>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

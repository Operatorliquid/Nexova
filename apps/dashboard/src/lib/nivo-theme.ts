import type { PartialTheme } from '@nivo/theming';

/**
 * Build a Nivo theme that reads from CSS custom properties so it adapts to
 * dark/light mode automatically.
 */
export function getNivoTheme(): PartialTheme {
  const style = getComputedStyle(document.documentElement);
  const mutedFg = `hsl(${style.getPropertyValue('--muted-foreground').trim()})`;
  const border = `hsl(${style.getPropertyValue('--border').trim()})`;

  return {
    text: {
      fontSize: 11,
      fill: mutedFg,
    },
    axis: {
      ticks: {
        text: { fontSize: 11, fill: mutedFg },
        line: { stroke: 'transparent' },
      },
      domain: { line: { stroke: 'transparent' } },
    },
    grid: {
      line: { stroke: border, strokeDasharray: '3 3' },
    },
    crosshair: {
      line: { stroke: border, strokeWidth: 1 },
    },
    tooltip: {
      container: { display: 'none' }, // we use our own tooltip
    },
  };
}

export const CHART_COLORS = [
  'hsl(var(--primary))',
  '#22c55e',
  '#38bdf8',
  '#f59e0b',
  '#ef4444',
  '#a78bfa',
  '#ec4899',
  '#14b8a6',
];

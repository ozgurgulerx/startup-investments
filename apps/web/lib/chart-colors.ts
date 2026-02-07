/**
 * Shared chart color constants using CSS variables.
 * These resolve at runtime so charts adapt to dark/paper mode.
 */

export const CHART_COLORS = {
  primary: 'hsl(var(--chart-1))',
  secondary: 'hsl(var(--chart-2))',
  tertiary: 'hsl(var(--chart-3))',
  quaternary: 'hsl(var(--chart-4))',
  quinary: 'hsl(var(--chart-5))',
} as const;

/** Extended palette for charts needing >5 colors (e.g. pattern bars) */
export const CHART_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-3) / 0.7)',
  'hsl(var(--chart-4) / 0.7)',
  'hsl(var(--chart-5) / 0.7)',
] as const;

/** Grid and axis styling */
export const CHART_GRID = 'hsl(var(--border) / 0.4)';
export const CHART_AXIS = 'hsl(var(--muted-foreground) / 0.5)';
export const CHART_CURSOR = 'hsl(var(--muted) / 0.5)';

/** Semantic chart colors */
export const CHART_SEMANTIC = {
  growth: 'hsl(var(--success))',
  decline: 'hsl(var(--destructive))',
  delta: 'hsl(var(--delta))',
  muted: 'hsl(var(--muted))',
  unknown: 'hsl(var(--muted-foreground) / 0.3)',
} as const;

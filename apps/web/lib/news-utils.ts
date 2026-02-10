import { safeDate } from '@/lib/safe-date';

/**
 * Human-friendly relative time label for news items.
 * Uses safeDate() for Safari-compatible date parsing.
 */
export function timeAgo(iso: string): string {
  const now = Date.now();
  const then = safeDate(iso).getTime();
  if (then === 0) return 'just now';
  const diff = Math.max(0, now - then);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Shared story-type → color token map. */
const STORY_TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  funding:    { border: 'success', bg: 'success', text: 'success' },
  mna:        { border: 'delta',   bg: 'delta',   text: 'delta' },
  regulation: { border: 'warning', bg: 'warning', text: 'warning' },
  launch:     { border: 'accent-info', bg: 'accent-info', text: 'accent-info' },
};

/** Badge-level flat colors for story type (used in StoryCard / radar list). */
export function storyTypeBadgeClass(storyType: string): string {
  const c = STORY_TYPE_COLORS[(storyType || '').toLowerCase()];
  if (!c) return 'border-border/40 bg-muted/10 text-muted-foreground';
  return `border-${c.border}/30 bg-${c.bg}/10 text-${c.text}`;
}

/** Card-level gradient tint for story type (used in NewsCard grid). */
export function storyTypeToneClass(storyType: string): string {
  const c = STORY_TYPE_COLORS[(storyType || '').toLowerCase()];
  if (!c) return 'border-border/40 bg-card/65';
  return `border-${c.border}/30 bg-gradient-to-br from-${c.bg}/10 via-card/70 to-card/60`;
}

/** Consistent AI signal badge label. */
export function aiSignalLabel(score: number): string {
  return `AI ${Math.round(score * 100)}%`;
}

const FRAME_LABELS: Record<string, string> = {
  UNDERWRITING_TAKE: 'Underwriting Take',
  ADOPTION_PLAY: 'Adoption Play',
  COST_CURVE: 'Cost Curve',
  LATENCY_LEVER: 'Latency Lever',
  BENCHMARK_TRAP: 'Benchmark Trap',
  DATA_MOAT: 'Data Moat',
  PROCUREMENT_WEDGE: 'Procurement Wedge',
  REGULATORY_CONSTRAINT: 'Regulatory Constraint',
  ATTACK_SURFACE: 'Attack Surface',
  CONSOLIDATION_SIGNAL: 'Consolidation Signal',
  HIRING_SIGNAL: 'Hiring Signal',
  PLATFORM_SHIFT: 'Platform Shift',
  GO_TO_MARKET_EDGE: 'Go-to-Market Edge',
  EARLY_SIGNAL: 'Early Signal',
};

export function frameLabel(frame: string): string {
  return FRAME_LABELS[frame] || 'Why It Matters';
}

export type ImpactDisplayMode = 'full' | 'compact' | 'early_signal';

export function impactDisplayMode(
  impact: { frame: string; builder_move: string },
  confidenceScore?: number,
): ImpactDisplayMode {
  if (impact.frame === 'EARLY_SIGNAL' || (confidenceScore != null && confidenceScore < 0.45))
    return 'early_signal';
  if (impact.builder_move?.length > 0) return 'full';
  return 'compact';
}

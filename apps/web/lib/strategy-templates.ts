export type DeltaType =
  | 'Capital Move'
  | 'Consolidation'
  | 'Regulatory Shift'
  | 'Product Launch'
  | 'Talent Signal'
  | 'Platform Shift'
  | 'Early Signal'
  | 'Market Signal';

const IMPLICATION_TEMPLATES: Record<string, (entity?: string) => string> = {
  'Capital Move': (e) => e
    ? `Category momentum rising around ${e}. Map adjacent opportunity.`
    : 'Category momentum rising. Map adjacent opportunity.',
  'Consolidation': (e) => e
    ? `Bundling power increasing near ${e}. Reassess build-vs-buy.`
    : 'Bundling power increasing. Reassess build-vs-buy.',
  'Regulatory Shift': () => 'Compliance exposure changing. Review rollout timelines.',
  'Product Launch': (e) => e
    ? `Competitive surface expanding around ${e}. Evaluate positioning overlap.`
    : 'Competitive surface expanding. Evaluate positioning overlap.',
  'Talent Signal': () => 'Execution ramp signals strategic pivot. Watch product changes.',
  'Platform Shift': () => 'Stack standardization risk. New default dependency emerging.',
  'Early Signal': () => 'Weak signal. Watch for corroboration and follow-on execution.',
  'Market Signal': () => 'Monitor for pattern confirmation across sources.',
};

export function getStrategyImplication(deltaType: string, entityName?: string): string {
  const template = IMPLICATION_TEMPLATES[deltaType] || IMPLICATION_TEMPLATES['Market Signal'];
  return template(entityName);
}

const DECISION_TAGS: Record<string, string[]> = {
  'Capital Move': ['Competitive', 'Roadmap'],
  'Consolidation': ['Partner', 'Competitive'],
  'Regulatory Shift': ['Risk'],
  'Product Launch': ['Roadmap', 'Competitive'],
  'Talent Signal': ['Competitive'],
  'Platform Shift': ['Roadmap', 'Risk'],
  'Early Signal': ['Watch'],
  'Market Signal': ['Watch'],
};

export function getDecisionTags(deltaType: string): string[] {
  return DECISION_TAGS[deltaType] || ['Watch'];
}

const DELTA_TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  'Capital Move':     { border: 'success',     bg: 'success',     text: 'success' },
  'Consolidation':    { border: 'delta',       bg: 'delta',       text: 'delta' },
  'Regulatory Shift': { border: 'warning',     bg: 'warning',     text: 'warning' },
  'Product Launch':   { border: 'accent-info', bg: 'accent-info', text: 'accent-info' },
  'Talent Signal':    { border: 'accent',      bg: 'accent',      text: 'accent' },
  'Platform Shift':   { border: 'accent-info', bg: 'accent-info', text: 'accent-info' },
  'Early Signal':     { border: 'border',      bg: 'muted',       text: 'muted-foreground' },
  'Market Signal':    { border: 'border',      bg: 'muted',       text: 'muted-foreground' },
};

export function deltaTypeBadgeClass(deltaType: string): string {
  const c = DELTA_TYPE_COLORS[deltaType];
  if (!c) return 'border-border/40 bg-muted/10 text-muted-foreground';
  return `border-${c.border}/30 bg-${c.bg}/10 text-${c.text}`;
}

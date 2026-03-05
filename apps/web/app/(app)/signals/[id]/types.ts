import type {
  DeepDiveContent,
  DeepDiveResponse,
  OccurrenceItem,
  MoveItem,
  SignalItem,
} from '@/lib/api/types';

export type { DeepDiveContent, DeepDiveResponse, OccurrenceItem, MoveItem, SignalItem };

export type DeepDivePrimaryTab = 'delta' | 'evidence' | 'actions';
export type DeepDiveMoreTab = 'explorer' | 'relevance' | 'counter' | 'community' | 'mechanism';
export type DeepDiveTab = DeepDivePrimaryTab | DeepDiveMoreTab;

export const PRIMARY_TAB_CONFIG: Array<{ id: DeepDivePrimaryTab; label: string }> = [
  { id: 'delta', label: 'Delta' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'actions', label: 'Actions' },
];

export const MORE_TAB_CONFIG: Array<{ id: DeepDiveMoreTab; label: string }> = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'relevance', label: 'Relevance' },
  { id: 'counter', label: 'Counterevidence' },
  { id: 'community', label: 'Community' },
  { id: 'mechanism', label: 'How It Works' },
];

export const LEGACY_TAB_REDIRECT: Record<string, DeepDiveTab> = {
  delta: 'delta',
  cases: 'evidence',
  evidence: 'evidence',
  actions: 'actions',
  mechanism: 'actions',
  explorer: 'explorer',
  relevance: 'relevance',
  counter: 'counter',
  community: 'community',
};

export const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  candidate: { bg: 'bg-muted/30', text: 'text-muted-foreground', label: 'Candidate' },
  emerging: { bg: 'bg-accent-info/10', text: 'text-accent-info', label: 'Emerging' },
  accelerating: { bg: 'bg-accent/10', text: 'text-accent', label: 'Accelerating' },
  established: { bg: 'bg-foreground/10', text: 'text-foreground', label: 'Established' },
  decaying: { bg: 'bg-destructive/10', text: 'text-destructive', label: 'Decaying' },
};

export const DOMAIN_LABELS: Record<string, string> = {
  architecture: 'Architecture',
  gtm: 'GTM',
  capital: 'Capital',
  org: 'Organization',
  product: 'Product',
};

export const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-Seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
  series_c: 'Series C',
  series_d_plus: 'Series D+',
  late_stage: 'Late',
  unknown: 'Unknown',
};

export const MOVE_TYPE_LABELS: Record<string, string> = {
  oss_launch: 'Open Source Launch',
  integration_push: 'Integration Push',
  community_funnel: 'Community Funnel',
  pricing_wedge: 'Pricing Wedge',
  enterprise_pivot: 'Enterprise Pivot',
  vertical_expansion: 'Vertical Expansion',
  platform_play: 'Platform Play',
  developer_advocacy: 'Developer Advocacy',
  data_moat: 'Data Moat',
  compliance_push: 'Compliance Push',
  hiring_signal: 'Hiring Signal',
  partnership: 'Partnership',
  product_launch: 'Product Launch',
  architecture_shift: 'Architecture Shift',
  funding_milestone: 'Funding Milestone',
};

import type {
  DeepDiveContent,
  DeepDiveResponse,
  OccurrenceItem,
  MoveItem,
  SignalItem,
} from '@/lib/api/client';

export type { DeepDiveContent, DeepDiveResponse, OccurrenceItem, MoveItem, SignalItem };

export type DeepDiveTab = 'delta' | 'mechanism' | 'cases' | 'explorer' | 'counter';

export const TAB_CONFIG: Array<{ id: DeepDiveTab; label: string }> = [
  { id: 'delta', label: 'Delta Board' },
  { id: 'mechanism', label: 'How It Works' },
  { id: 'cases', label: 'Case Studies' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'counter', label: 'Counterevidence' },
];

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

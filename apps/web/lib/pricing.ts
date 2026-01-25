// Pricing and plan information - shared between server and client components

export type Plan = 'free' | 'pro' | 'team';

export type Feature =
  | 'full_brief'
  | 'dealbook_filters'
  | 'dealbook_export'
  | 'watchlist'
  | 'company_deep_dive'
  | 'pattern_details'
  | 'capital_flows'
  | 'library_full'
  | 'compare_months'
  | 'pdf_export';

// Feature access matrix
export const FEATURE_ACCESS: Record<Feature, Plan[]> = {
  full_brief: ['pro', 'team'],
  dealbook_filters: ['pro', 'team'],
  dealbook_export: ['pro', 'team'],
  watchlist: ['pro', 'team'],
  company_deep_dive: ['pro', 'team'],
  pattern_details: ['free', 'pro', 'team'], // Preview available to all
  capital_flows: ['pro', 'team'],
  library_full: ['pro', 'team'],
  compare_months: ['team'],
  pdf_export: ['pro', 'team'],
};

// Plan display info
export const PLAN_INFO: Record<Plan, { name: string; color: string; features: string[] }> = {
  free: {
    name: 'Free',
    color: 'text-muted-foreground',
    features: [
      'Monthly brief summary',
      'Top 5 deals preview',
      'Pattern overview',
    ],
  },
  pro: {
    name: 'Pro',
    color: 'text-accent',
    features: [
      'Full monthly briefs',
      'Complete dealbook access',
      'Advanced filters & export',
      'Watchlist (up to 50)',
      'Company deep dives',
      'PDF exports',
    ],
  },
  team: {
    name: 'Team',
    color: 'text-accent',
    features: [
      'Everything in Pro',
      'Unlimited watchlist',
      'Month comparison tools',
      'Team sharing',
      'API access (coming soon)',
    ],
  },
};

// Pricing info
export const PRICING: Record<Plan, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  pro: { monthly: 49, annual: 399 },
  team: { monthly: 149, annual: 1199 },
};

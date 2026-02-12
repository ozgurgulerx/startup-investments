/**
 * Feature gating utilities
 *
 * Supports plan-based access control (free/pro/team)
 */

/**
 * Available user plans
 */
export type UserPlan = 'free' | 'pro' | 'team';

/**
 * Features that can be gated
 */
export type Feature =
  | 'saved_filters'
  | 'filter_alerts'
  | 'export_memo'
  | 'pattern_correlations'
  | 'company_deep_dive'
  | 'signal_deep_dive'
  | 'api_access'
  | 'team_sharing'
  | 'priority_notifications'
  | 'historical_data';

/**
 * Feature access configuration by plan
 */
const FEATURE_ACCESS: Record<UserPlan, Set<Feature>> = {
  free: new Set([
    'saved_filters', // Limited to 3
    'export_memo',
    'company_deep_dive',
    'signal_deep_dive',
  ]),
  pro: new Set([
    'saved_filters',
    'filter_alerts',
    'export_memo',
    'pattern_correlations',
    'company_deep_dive',
    'signal_deep_dive',
    'api_access',
    'priority_notifications',
    'historical_data',
  ]),
  team: new Set([
    'saved_filters',
    'filter_alerts',
    'export_memo',
    'pattern_correlations',
    'company_deep_dive',
    'signal_deep_dive',
    'api_access',
    'team_sharing',
    'priority_notifications',
    'historical_data',
  ]),
};

/**
 * Limits for features by plan
 */
export const PLAN_LIMITS: Record<UserPlan, {
  savedFilters: number;
  watchlistItems: number;
  exportFrequency: 'daily' | 'unlimited';
  apiCalls: number;
}> = {
  free: {
    savedFilters: 3,
    watchlistItems: 10,
    exportFrequency: 'daily',
    apiCalls: 0,
  },
  pro: {
    savedFilters: 25,
    watchlistItems: 100,
    exportFrequency: 'unlimited',
    apiCalls: 1000,
  },
  team: {
    savedFilters: 100,
    watchlistItems: 500,
    exportFrequency: 'unlimited',
    apiCalls: 10000,
  },
};

/**
 * Check if a user has access to a feature
 */
export function hasFeatureAccess(plan: UserPlan | undefined, feature: Feature): boolean {
  const userPlan = plan || 'free';
  return FEATURE_ACCESS[userPlan]?.has(feature) ?? false;
}

/**
 * Get the limits for a user's plan
 */
export function getPlanLimits(plan: UserPlan | undefined) {
  return PLAN_LIMITS[plan || 'free'];
}

/**
 * Check if a user is within their saved filters limit
 */
export function canCreateSavedFilter(plan: UserPlan | undefined, currentCount: number): boolean {
  const limits = getPlanLimits(plan);
  return currentCount < limits.savedFilters;
}

/**
 * Check if a user is within their watchlist limit
 */
export function canAddToWatchlist(plan: UserPlan | undefined, currentCount: number): boolean {
  const limits = getPlanLimits(plan);
  return currentCount < limits.watchlistItems;
}

/**
 * Get upgrade prompt for a feature
 */
export function getUpgradePrompt(feature: Feature): {
  title: string;
  description: string;
  cta: string;
} {
  const prompts: Record<Feature, { title: string; description: string; cta: string }> = {
    saved_filters: {
      title: 'Upgrade to save more filters',
      description: 'Free accounts can save up to 3 filters. Upgrade to Pro for 25 filters.',
      cta: 'Upgrade to Pro',
    },
    filter_alerts: {
      title: 'Get notified when new deals match your filters',
      description: 'Pro users receive alerts when new startups match their saved filter criteria.',
      cta: 'Upgrade to Pro',
    },
    export_memo: {
      title: 'Export your watchlist as a memo',
      description: 'Download a formatted memo of your watchlist for sharing and reference.',
      cta: 'Get Started',
    },
    pattern_correlations: {
      title: 'Unlock pattern correlation insights',
      description: 'See how build patterns correlate and co-occur across funded startups.',
      cta: 'Upgrade to Pro',
    },
    company_deep_dive: {
      title: 'Deep dive into company analysis',
      description: 'Access detailed pattern analysis and technical breakdowns for each startup.',
      cta: 'Get Started',
    },
    signal_deep_dive: {
      title: 'Signal deep dives',
      description: 'Access full deep dive reports with case studies, playbooks, and failure modes for each signal.',
      cta: 'Get Started',
    },
    api_access: {
      title: 'Access the Build Atlas API',
      description: 'Integrate startup intelligence directly into your tools and workflows.',
      cta: 'Upgrade to Pro',
    },
    team_sharing: {
      title: 'Share with your team',
      description: 'Collaborate on watchlists and filters with your team members.',
      cta: 'Upgrade to Team',
    },
    priority_notifications: {
      title: 'Get priority notifications',
      description: 'Receive notifications for significant funding events before everyone else.',
      cta: 'Upgrade to Pro',
    },
    historical_data: {
      title: 'Access historical data',
      description: 'Explore funding trends and patterns across multiple months.',
      cta: 'Upgrade to Pro',
    },
  };

  return prompts[feature];
}

/**
 * Plan display names and descriptions
 */
export const PLAN_INFO: Record<UserPlan, {
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  features: string[];
}> = {
  free: {
    name: 'Free',
    description: 'For individual exploration',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      'Browse all startup dossiers',
      'Save up to 3 filters',
      'Watchlist up to 10 startups',
      'Export watchlist memo (daily)',
    ],
  },
  pro: {
    name: 'Pro',
    description: 'For serious builders and investors',
    monthlyPrice: 29,
    annualPrice: 290,
    features: [
      'Everything in Free',
      'Save up to 25 filters',
      'Filter alerts & notifications',
      'Pattern correlation insights',
      'Watchlist up to 100 startups',
      'Unlimited exports',
      'API access (1,000 calls/month)',
      'Historical data access',
    ],
  },
  team: {
    name: 'Team',
    description: 'For investment teams and startups',
    monthlyPrice: 99,
    annualPrice: 990,
    features: [
      'Everything in Pro',
      'Team sharing & collaboration',
      'Save up to 100 filters',
      'Watchlist up to 500 startups',
      'API access (10,000 calls/month)',
      'Priority support',
    ],
  },
};

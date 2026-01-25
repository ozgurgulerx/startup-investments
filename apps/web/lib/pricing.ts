// Feature flags - all features are currently open to everyone
// This file is kept for future feature gating if needed

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

// All features are open - no restrictions
export function canAccessFeature(_feature: Feature): boolean {
  return true;
}

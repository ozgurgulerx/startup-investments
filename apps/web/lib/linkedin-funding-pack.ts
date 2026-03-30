export type LinkedinAssetSlug =
  | 'all'
  | 'hero'
  | 'deal-ladder'
  | 'stage-tension'
  | 'capital-flow'
  | 'market-map'
  | 'daily-pulse'
  | 'theme-matrix'
  | 'theme-rank';

export interface FundingPackSummary {
  roundCount: number;
  totalFundingUsd: number;
  medianRoundUsd: number;
  seedRoundCount: number;
  seedCapitalUsd: number;
  top5CapitalSharePct: number;
  top10CapitalSharePct: number;
  leadingTheme: string;
  leadingThemeFundingUsd: number;
  leadingCountry: string;
  leadingCountrySharePct: number;
  topFundingDay: {
    date: string;
    dayLabel: string;
    rounds: number;
    capitalUsd: number;
  } | null;
}

export interface FundingThemeRow {
  name: string;
  rounds: number;
  capitalUsd: number;
  sharePct: number;
  color: string;
}

export interface FundingStageRow {
  stage: string;
  rounds: number;
  capitalUsd: number;
  roundSharePct: number;
  capitalSharePct: number;
  avgRoundUsd: number;
}

export interface FundingCountryRow {
  name: string;
  rounds: number;
  capitalUsd: number;
  sharePct: number;
}

export interface FundingSubthemeRow {
  name: string;
  rounds: number;
  capitalUsd: number;
  sharePct: number;
}

export interface FundingDealRow {
  name: string;
  company: string;
  theme: string;
  subtheme: string;
  fundingType: string;
  stageBucket: string;
  capitalUsd: number;
  date: string | null;
  country: string;
  investors: string[];
  url: string;
}

export interface FundingDailyRow {
  date: string;
  dayLabel: string;
  rounds: number;
  capitalUsd: number;
}

export interface FundingFlowNode {
  id: string;
  kind: 'country' | 'theme' | 'stage';
}

export interface FundingFlowLink {
  source: string;
  target: string;
  value: number;
}

export interface FundingTreemapLeaf {
  name: string;
  size: number;
  stage: string;
  theme: string;
  date: string | null;
}

export interface FundingTreemapTheme {
  name: string;
  color: string;
  children: FundingTreemapLeaf[];
}

export interface FundingTreemapRoot {
  name: string;
  children: FundingTreemapTheme[];
}

export interface ThemeStageMatrixCell {
  stage: string;
  rounds: number;
  capitalUsd: number;
}

export interface ThemeStageMatrixRow {
  theme: string;
  color: string;
  cells: ThemeStageMatrixCell[];
}

export interface ThemeStageMatrix {
  stages: string[];
  rows: ThemeStageMatrixRow[];
  maxCapitalUsd: number;
}

export interface LinkedinFundingPackData {
  meta: {
    title: string;
    periodLabel: string;
    sourceWorkbook: string;
    generatedAt: string;
  };
  summary: FundingPackSummary;
  themes: FundingThemeRow[];
  subthemes: FundingSubthemeRow[];
  stages: FundingStageRow[];
  countries: FundingCountryRow[];
  continents: {
    name: string;
    capitalUsd: number;
  }[];
  topDeals: FundingDealRow[];
  daily: FundingDailyRow[];
  dailyPeaks: FundingDailyRow[];
  topInvestors: {
    name: string;
    capitalUsd: number;
  }[];
  heroTreemap: FundingTreemapRoot;
  capitalFlow: {
    nodes: FundingFlowNode[];
    links: FundingFlowLink[];
  };
  themeStageMatrix: ThemeStageMatrix;
}

export const LINKEDIN_ASSETS: Array<{
  slug: Exclude<LinkedinAssetSlug, 'all'>;
  label: string;
}> = [
  { slug: 'hero', label: 'Hero Treemap' },
  { slug: 'deal-ladder', label: 'Deal Ladder' },
  { slug: 'stage-tension', label: 'Stage Tension' },
  { slug: 'capital-flow', label: 'Capital Flow' },
  { slug: 'market-map', label: 'Market Map' },
  { slug: 'daily-pulse', label: 'Daily Pulse' },
  { slug: 'theme-matrix', label: 'Theme Matrix' },
  { slug: 'theme-rank', label: 'Theme Rank' },
];

export const THEME_COLORS: Record<string, string> = {
  'Frontier Lab': '#2457FF',
  'AI Infrastructure': '#0E8F7A',
  Robotics: '#F36A2D',
  Defense: '#1D3557',
  'Health + Life Sciences': '#E24D6B',
  'Predictive Markets': '#B06A00',
  LegalTech: '#6D5BD0',
  'AI Dev Tools': '#2884C7',
  'AI Agents': '#4E7A43',
  Security: '#7A2E3A',
  'Other Themes': '#94A3B8',
  Untagged: '#CBD5E1',
};

export const STAGE_COLORS: Record<string, string> = {
  'Pre-Seed': '#CBD5E1',
  Seed: '#2D8CFF',
  'Series A': '#E8A317',
  'Series B': '#F36A2D',
  'Series C+': '#0F766E',
  'Venture / Unknown': '#111827',
  Other: '#94A3B8',
};

export function formatUsdCompact(value: number, digits = 1): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(digits)}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(abs >= 100_000_000 ? 0 : digits)}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function chartThemeColor(label: string): string {
  return THEME_COLORS[label] || THEME_COLORS['Other Themes'];
}

export function stageColor(label: string): string {
  return STAGE_COLORS[label] || STAGE_COLORS.Other;
}

export function hexToRgba(hex: string, alpha: number): string {
  const safe = hex.replace('#', '');
  const normalized = safe.length === 3
    ? safe.split('').map((ch) => `${ch}${ch}`).join('')
    : safe;
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

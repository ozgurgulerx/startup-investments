import type { StartupAnalysis } from '@startup-intelligence/shared';

export interface PatternData {
  name: string;
  count: number;
  conviction: 'high' | 'medium' | 'emerging';
  companies: StartupAnalysis[];
  thesis: string;
  enables: string;
  risk: string;
  horizon: string;
}

export interface EmergingPattern {
  name: string;
  category: string;
  count: number;
  avgNovelty: number;
  companies: StartupAnalysis[];
  whyNotable: string;
}

export interface CategoryData {
  name: string;
  count: number;
  patterns: string[];
}

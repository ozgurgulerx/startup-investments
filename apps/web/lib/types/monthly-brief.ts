/**
 * Monthly Intelligence Brief Schema
 *
 * This schema defines the structure for the monthly intelligence brief JSON file.
 * All data is derived from the monthly_stats.json and startup analyses.
 */

export interface MonthlyBrief {
  // Core identifiers
  monthKey: string; // e.g. "2026-01"
  title: string; // e.g. "January 2026 Intelligence Brief"
  subtitle: string; // "The AI Builder's Intelligence Brief"
  hook: string; // e.g. "What $31B in AI funding reveals..."
  generatedAt: string; // ISO timestamp

  // Executive Summary (70-120 words, LLM generated)
  executiveSummary: string;

  // Key Metrics
  metrics: {
    totalFunding: number;
    totalDeals: number;
    avgDeal: number;
    medianDeal: number;
    largestDeal: {
      company: string;
      amount: number;
      stage: string;
    };
    genaiAdoptionPct: number;
  };

  // Theme (LLM generated name + bullets)
  theme: {
    name: string; // e.g. "The Specialization Era"
    summaryBullets: string[]; // 3-4 key takeaways
  };

  // Pattern Landscape
  patternLandscape: Array<{
    pattern: string;
    prevalencePct: number;
    startupCount: number;
    signal: string; // One-line insight (LLM generated)
  }>;

  // Funding by Stage
  fundingByStage: Array<{
    stage: string;
    amount: number;
    pct: number;
    deals: number;
  }>;

  // Top Deals
  topDeals: Array<{
    rank: number;
    company: string;
    slug: string;
    amount: number;
    stage: string;
    location: string;
    vertical?: string;
  }>;

  // Geographic Distribution
  geography: Array<{
    region: string;
    deals: number;
    totalFunding: number;
    avgDeal: number;
  }>;

  // US Dominance section
  usDominance: {
    californiaTotal: number;
    californiaPct: number;
    cities: Array<{
      city: string;
      deals: number;
      totalFunding: number;
    }>;
  };

  // Emerging Hubs
  emergingHubs: Array<{
    city: string;
    totalFunding: number;
    deals: number;
  }>;

  // Investor Intelligence
  investors: {
    mostActive: Array<{
      name: string;
      deals: number;
      totalDeployed: number;
      notableBets: string;
    }>;
    megaCheckWriters: Array<{
      name: string;
      singleInvestment: number;
      company: string;
    }>;
  };

  // Featured Spotlight (optional)
  spotlight?: {
    company: string;
    slug: string;
    amount: number;
    stage: string;
    location: string;
    vertical: string;
    whyThisMatters: string;
    technicalBet?: string;
    buildPatterns: string[];
    risk: string;
    builderTakeaway: string;
  };

  // Builder Lessons (LLM generated)
  builderLessons: Array<{
    title: string;
    text: string;
    howToApply?: string;
  }>;

  // What We're Watching (LLM generated)
  whatWatching: string[];

  // Methodology
  methodology: {
    bullets: string[];
    dataSources: string[];
  };
}

/**
 * Helper type for briefing display data
 */
export interface BriefingDisplayData {
  period: string;
  displayMonth: string;
  displayYear: string;
  brief: MonthlyBrief;
}

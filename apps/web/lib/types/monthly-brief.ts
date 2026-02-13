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

  // Vertical / Subvertical Landscape
  verticalLandscape?: {
    topVerticals: Array<{
      id: string;
      label: string;
      startupCount: number;
      dealCount: number;
      totalFunding: number;
      pctOfFunding: number;
      prevPctOfFunding?: number;
      deltaPp?: number;
    }>;
    topSubVerticals: Array<{
      id: string;
      label: string;
      verticalId: string;
      verticalLabel: string;
      startupCount: number;
      dealCount: number;
      totalFunding: number;
      pctOfFunding: number;
      prevPctOfFunding?: number;
      deltaPp?: number;
    }>;
  };

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
    subVertical?: string;
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

  // Capital Graph pulse (optional; available on snapshot-backed briefs)
  capitalGraph?: {
    available: boolean;
    nodes: {
      investors: number;
      founders: number;
      startups: number;
    };
    edges: {
      investorStartupActive: number;
      founderStartupActive: number;
      investorStartupAddedInPeriod: number;
      founderStartupAddedInPeriod: number;
    };
    topInvestors: Array<{
      id: string;
      name: string;
      startupCount: number;
      leadEdgeCount: number;
    }>;
    topFounders: Array<{
      id: string;
      name: string;
      startupCount: number;
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
    subVertical?: string;
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

/**
 * Convert a BriefSnapshot (new API format) to MonthlyBrief (legacy format)
 * for backward-compatible rendering.
 */
export function snapshotToMonthlyBrief(snapshot: {
  periodKey: string;
  periodLabel: string;
  generatedAt: string;
  metrics: {
    totalFunding: number;
    dealCount: number;
    avgDeal: number;
    medianDeal: number;
    largestDeal: { company: string; slug: string; amount: number; stage: string };
    genaiAdoptionRate: number;
  };
  executiveSummary: string;
  theme: { name: string; summaryBullets: string[] };
  patternLandscape: Array<{ pattern: string; prevalencePct: number; startupCount: number; signal: string }>;
  verticalLandscape?: {
    topVerticals: Array<{
      id: string;
      label: string;
      startupCount: number;
      dealCount: number;
      totalFunding: number;
      pctOfFunding: number;
      prevPctOfFunding?: number;
      deltaPp?: number;
    }>;
    topSubVerticals: Array<{
      id: string;
      label: string;
      verticalId: string;
      verticalLabel: string;
      startupCount: number;
      dealCount: number;
      totalFunding: number;
      pctOfFunding: number;
      prevPctOfFunding?: number;
      deltaPp?: number;
    }>;
  };

  // Capital Graph pulse (optional; available on snapshot-backed briefs)
  capitalGraph?: {
    available: boolean;
    nodes: {
      investors: number;
      founders: number;
      startups: number;
    };
    edges: {
      investorStartupActive: number;
      founderStartupActive: number;
      investorStartupAddedInPeriod: number;
      founderStartupAddedInPeriod: number;
    };
    topInvestors: Array<{
      id: string;
      name: string;
      startupCount: number;
      leadEdgeCount: number;
    }>;
    topFounders: Array<{
      id: string;
      name: string;
      startupCount: number;
    }>;
  };
  fundingByStage: Array<{ stage: string; amount: number; pct: number; deals: number }>;
  topDeals: Array<{ rank: number; company: string; slug: string; amount: number; stage: string; location: string; vertical?: string; subVertical?: string }>;
  geography: Array<{ region: string; deals: number; totalFunding: number; avgDeal: number }>;
  investors: {
    mostActive: Array<{ name: string; deals: number; totalDeployed: number }>;
    megaCheckWriters: Array<{ name: string; singleInvestment: number; company: string }>;
  };
  spotlight?: {
    company: string; slug: string; amount: number; stage: string; location: string;
    vertical?: string; subVertical?: string;
    whyThisMatters: string; buildPatterns: string[]; risk: string; builderTakeaway: string;
  };
  builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
  whatWatching: string[];
  methodology: { bullets: string[] };
}): MonthlyBrief {
  const m = snapshot.metrics;
  return {
    monthKey: snapshot.periodKey,
    title: `${snapshot.periodLabel} Intelligence Brief`,
    subtitle: "The AI Builder's Intelligence Brief",
    hook: `What $${(m.totalFunding / 1_000_000_000).toFixed(1)}B in AI funding reveals about where the industry is heading.`,
    generatedAt: snapshot.generatedAt,
    executiveSummary: snapshot.executiveSummary,
    metrics: {
      totalFunding: m.totalFunding,
      totalDeals: m.dealCount,
      avgDeal: m.avgDeal,
      medianDeal: m.medianDeal,
      largestDeal: { company: m.largestDeal.company, amount: m.largestDeal.amount, stage: m.largestDeal.stage },
      genaiAdoptionPct: m.genaiAdoptionRate,
    },
    theme: snapshot.theme,
    patternLandscape: snapshot.patternLandscape,
    verticalLandscape: snapshot.verticalLandscape || { topVerticals: [], topSubVerticals: [] },
    fundingByStage: snapshot.fundingByStage,
    topDeals: snapshot.topDeals,
    geography: snapshot.geography,
    usDominance: { californiaTotal: 0, californiaPct: 0, cities: [] },
    emergingHubs: [],
    investors: {
      mostActive: snapshot.investors.mostActive.map(inv => ({ ...inv, notableBets: '' })),
      megaCheckWriters: snapshot.investors.megaCheckWriters,
    },
    capitalGraph: snapshot.capitalGraph,
    spotlight: snapshot.spotlight ? {
      ...snapshot.spotlight,
      vertical: snapshot.spotlight.vertical || 'Unknown',
      subVertical: snapshot.spotlight.subVertical,
    } : undefined,
    builderLessons: snapshot.builderLessons,
    whatWatching: snapshot.whatWatching,
    methodology: {
      bullets: snapshot.methodology.bullets,
      dataSources: [],
    },
  };
}

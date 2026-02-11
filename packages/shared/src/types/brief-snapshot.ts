// =============================================================================
// Dealbook Brief Snapshot Types
// =============================================================================

export interface BriefSnapshotMetrics {
  totalFunding: number;
  dealCount: number;
  avgDeal: number;
  medianDeal: number;
  largestDeal: { company: string; slug: string; amount: number; stage: string };
  genaiAdoptionRate: number;      // 0-100 percentage
  analysisCount: number;          // how many startups had analysis run
  topPatterns: Array<{ pattern: string; count: number; prevalencePct: number }>;
  stageMix: Array<{ stage: string; amount: number; deals: number; pct: number }>;
}

export interface BriefSnapshotDeltas {
  totalFunding: { value: number; pct: number } | null;
  dealCount: { value: number; pct: number } | null;
  avgDeal: { value: number; pct: number } | null;
  genaiAdoptionRate: { ppChange: number } | null;  // percentage-point change
  patternShifts: Array<{ pattern: string; prevPct: number; currPct: number; deltaPp: number }>;
  stageShifts: Array<{ stage: string; prevPct: number; currPct: number; deltaPp: number }>;
}

export interface BriefNewsContext {
  clusters: Array<{
    id: string;
    title: string;
    summary: string;
    storyType: string;
    publishedAt: string;
    linkedStartupSlugs: string[];
    rankScore: number;
  }>;
  topEntities: Array<{ name: string; factCount: number; latestFact: string }>;
}

export interface BriefSnapshot {
  id: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  revisionNumber: number;
  generatedAt: string;

  metrics: BriefSnapshotMetrics;
  prevPeriod: BriefSnapshotMetrics | null;
  deltas: BriefSnapshotDeltas | null;
  newsContext: BriefNewsContext | null;

  // LLM sections
  deltaBullets: string[];
  executiveSummary: string;
  theme: { name: string; summaryBullets: string[] };
  builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
  whatWatching: string[];

  // Deterministic sections
  patternLandscape: Array<{ pattern: string; prevalencePct: number; startupCount: number; signal: string }>;
  fundingByStage: Array<{ stage: string; amount: number; pct: number; deals: number }>;
  topDeals: Array<{ rank: number; company: string; slug: string; amount: number; stage: string; location: string }>;
  geography: Array<{ region: string; deals: number; totalFunding: number; avgDeal: number }>;
  investors: {
    mostActive: Array<{ name: string; deals: number; totalDeployed: number }>;
    megaCheckWriters: Array<{ name: string; singleInvestment: number; company: string }>;
  };
  spotlight?: {
    company: string;
    slug: string;
    amount: number;
    stage: string;
    location: string;
    whyThisMatters: string;
    buildPatterns: string[];
    risk: string;
    builderTakeaway: string;
  };
  methodology: { bullets: string[] };

  status: 'draft' | 'ready' | 'sealed';
}

export interface BriefSnapshotSummary {
  id: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodLabel: string;
  revisionNumber: number;
  generatedAt: string;
  dealCount: number;
  totalFunding: number;
  status: 'draft' | 'ready' | 'sealed';
}

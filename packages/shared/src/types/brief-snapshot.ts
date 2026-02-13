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

export interface BriefVerticalLandscape {
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

export interface SignalRef {
  clusterId: string;
  title: string;
  summary: string;
  storyType: string;
  builderTakeaway: string;
  signalScore: number;
  linkedSlugs: string[];
  publishedAt: string;
}

export interface BuilderActionRef {
  refType: 'signal' | 'pattern' | 'company';
  refId: string;       // clusterId, pattern name, or slug
  label: string;       // display text for the chip
  url: string;         // deep link
}

export interface BuilderAction {
  action: string;       // 1 sentence, 18-22 words
  rationale: string;    // 1 sentence (why this matters)
  refs: BuilderActionRef[];
}

export interface BriefSnapshot {
  id: string;
  editionId?: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  kind?: 'rolling' | 'sealed';
  revisionNumber: number;
  generatedAt: string;

  metrics: BriefSnapshotMetrics;
  prevPeriod: BriefSnapshotMetrics | null;
  deltas: BriefSnapshotDeltas | null;
  revisionDeltas: BriefSnapshotDeltas | null;
  prevPeriodBounds: { periodStart: string; periodEnd: string; mtdAligned: boolean } | null;
  newsContext: BriefNewsContext | null;
  topSignals: SignalRef[];

  // LLM sections
  deltaBullets: string[];
  revisionDeltaBullets: string[];
  executiveSummary: string;
  theme: { name: string; summaryBullets: string[] };
  builderLessons: Array<{ title: string; text: string; howToApply?: string }>;
  whatWatching: string[];
  builderActions: BuilderAction[];

  // Deterministic sections
  patternLandscape: Array<{ pattern: string; prevalencePct: number; startupCount: number; signal: string }>;
  verticalLandscape: BriefVerticalLandscape;
  fundingByStage: Array<{ stage: string; amount: number; pct: number; deals: number }>;
  topDeals: Array<{ rank: number; company: string; slug: string; amount: number; stage: string; location: string; vertical?: string; subVertical?: string }>;
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
    vertical?: string;
    subVertical?: string;
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

export interface BriefEditionSummary {
  editionId: string;
  region: 'global' | 'turkey';
  periodType: 'monthly' | 'weekly';
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  kind: 'rolling' | 'sealed';
  revisionNumber: number;
  generatedAt: string;
  dealCount: number;
  totalFunding: number;
  status: 'ready' | 'sealed';
}

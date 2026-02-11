import { Suspense } from 'react';
import { getMonthlyStats, getStartups, getAvailablePeriods } from '@/lib/data';
import { InteractiveSignals } from './interactive-signals';
import { computePatternCorrelations } from '@/lib/data/signals';
import { isAPIConfigured, getSignalsSummary } from '@/lib/api/client';
import type { SignalItem } from '@/lib/api/client';
import type { StartupAnalysis } from '@startup-intelligence/shared';

const FALLBACK_PERIOD = '2026-01';

// Pattern thesis descriptions (used for static fallback)
const PATTERN_THESIS: Record<string, {
  thesis: string;
  enables: string;
  risk: string;
  horizon: string;
}> = {
  'Agentic Architectures': {
    thesis: 'Autonomous systems that can plan, execute, and iterate without human intervention represent the next paradigm shift in enterprise software.',
    enables: 'Enables full workflow automation across legal, finance, and operations. Creates new category of "AI employees" that handle complex multi-step tasks.',
    risk: 'Reliability concerns in high-stakes environments may slow enterprise adoption. Regulatory uncertainty around autonomous decision-making.',
    horizon: '12-24 months',
  },
  'Vertical Data Moats': {
    thesis: 'Domain-specific datasets become the primary differentiator as foundation models commoditize. First-mover advantage in data accumulation creates durable competitive positions.',
    enables: 'Unlocks AI applications in regulated industries (healthcare, finance) where generic models fail. Creates acquisition targets for incumbents.',
    risk: 'Data licensing costs may erode margins. Privacy regulations could limit data accumulation strategies.',
    horizon: '0-12 months',
  },
  'RAG (Retrieval-Augmented Generation)': {
    thesis: 'Grounding LLM outputs in retrieved facts addresses hallucination concerns and enables enterprise-grade accuracy for knowledge work.',
    enables: 'Accelerates enterprise AI adoption by providing audit trails and source attribution. Reduces inference costs by minimizing context windows.',
    risk: 'Pattern becoming table stakes. Differentiation shifting to retrieval quality and domain expertise.',
    horizon: '0-12 months',
  },
  'Micro-model Meshes': {
    thesis: 'Orchestrating multiple specialized models outperforms monolithic approaches for complex tasks while reducing cost and latency.',
    enables: 'Enables cost-effective AI deployment for mid-market. Creates opportunity for specialized model providers.',
    risk: 'Orchestration complexity may outweigh benefits. Larger models may absorb specialized capabilities.',
    horizon: '12-24 months',
  },
  'Continuous-learning Flywheels': {
    thesis: 'Products that improve from usage create compounding advantages. User data continuously refines model performance, increasing switching costs.',
    enables: 'Winner-take-most dynamics in categories where this pattern is well-executed. Defensibility against well-funded competitors.',
    risk: 'Requires critical mass of users to generate meaningful signal. Privacy concerns may limit data collection.',
    horizon: '24+ months',
  },
  'Guardrail-as-LLM': {
    thesis: 'Secondary AI systems that validate and filter primary model outputs address enterprise trust requirements.',
    enables: 'Accelerates AI deployment in compliance-heavy industries. Creates new category of AI safety tooling.',
    risk: 'Adds latency and cost to inference. May become integrated into foundation model providers.',
    horizon: '0-12 months',
  },
};

function getConviction(count: number, total: number): 'high' | 'medium' | 'emerging' {
  const percentage = total > 0 ? count / total : 0;
  if (percentage > 0.15) return 'high';
  if (percentage > 0.08) return 'medium';
  return 'emerging';
}

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

async function SignalsContent({ region }: { region?: string }) {
  // Try API-driven dynamic signals first
  let fallbackReason: 'api_empty' | 'api_error' | undefined;
  if (isAPIConfigured()) {
    try {
      const summary = await getSignalsSummary(region);
      const hasSignals = summary.stats.total > 0;

      if (hasSignals) {
        return (
          <InteractiveSignals
            mode="dynamic"
            dynamicSignals={summary}
            region={region}
          />
        );
      }
      fallbackReason = 'api_empty';
    } catch {
      fallbackReason = 'api_error';
    }
  }

  // Fallback to static data
  const availablePeriods = await getAvailablePeriods(region);
  const latestPeriod = availablePeriods[0]?.period || FALLBACK_PERIOD;

  const [stats, startups] = await Promise.all([
    getMonthlyStats(latestPeriod, region),
    getStartups(latestPeriod, region),
  ]);

  const totalDeals = stats.deal_summary.total_deals;

  const patterns: PatternData[] = Object.entries(stats.genai_analysis.pattern_distribution)
    .filter(([name]) => name !== 'unknown')
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const companies = startups
        .filter(s => s.build_patterns?.some(p => p.name === name))
        .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));

      const thesisData = PATTERN_THESIS[name] || {
        thesis: 'Emerging pattern in AI infrastructure.',
        enables: 'Potential to unlock new application categories.',
        risk: 'Limited data on long-term viability.',
        horizon: '12-24 months',
      };

      return { name, count, conviction: getConviction(count, totalDeals), companies, ...thesisData };
    });

  const emergingPatternMap = new Map<string, {
    count: number;
    totalNovelty: number;
    category: string;
    companies: StartupAnalysis[];
    whyNotable: string;
  }>();

  for (const startup of startups) {
    const discoveredPatterns = startup.discovered_patterns || [];
    for (const pattern of discoveredPatterns) {
      const name = pattern.pattern_name || pattern.name || 'unknown_pattern';
      const novelty = pattern.novelty_score || 5;
      const category = pattern.category || 'Other';

      if (novelty >= 6) {
        const existing = emergingPatternMap.get(name);
        if (existing) {
          existing.count++;
          existing.totalNovelty += novelty;
          existing.companies.push(startup);
        } else {
          emergingPatternMap.set(name, {
            count: 1,
            totalNovelty: novelty,
            category,
            companies: [startup],
            whyNotable: pattern.why_notable || '',
          });
        }
      }
    }
  }

  const emergingPatterns: EmergingPattern[] = Array.from(emergingPatternMap.entries())
    .map(([name, data]) => ({
      name,
      category: data.category,
      count: data.count,
      avgNovelty: data.totalNovelty / data.count,
      companies: data.companies,
      whyNotable: data.whyNotable,
    }))
    .filter(p => p.count >= 2 || p.avgNovelty >= 8)
    .sort((a, b) => b.avgNovelty - a.avgNovelty);

  const categoryMap = new Map<string, { count: number; patterns: Set<string> }>();
  for (const startup of startups) {
    const discoveredPatterns = startup.discovered_patterns || [];
    for (const pattern of discoveredPatterns) {
      const category = pattern.category || 'Other';
      const patternKey = pattern.pattern_name || pattern.name || 'unknown_pattern';
      const existing = categoryMap.get(category);
      if (existing) {
        existing.count++;
        existing.patterns.add(patternKey);
      } else {
        categoryMap.set(category, { count: 1, patterns: new Set([patternKey]) });
      }
    }
  }

  const categories: CategoryData[] = Array.from(categoryMap.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      patterns: Array.from(data.patterns),
    }))
    .sort((a, b) => b.count - a.count);

  const correlations = computePatternCorrelations(startups);

  return (
    <InteractiveSignals
      mode="static"
      patterns={patterns}
      correlations={correlations}
      totalDeals={totalDeals}
      region={region}
      emergingPatterns={emergingPatterns}
      categories={categories}
      fallbackReason={fallbackReason}
    />
  );
}

function SignalsLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-4">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="h-8 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="py-8 border-b border-border/30">
            <div className="h-6 w-1/3 bg-muted rounded mb-4" />
            <div className="h-16 w-2/3 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const { region } = await searchParams;
  return (
    <Suspense fallback={<SignalsLoading />}>
      <SignalsContent region={region} />
    </Suspense>
  );
}

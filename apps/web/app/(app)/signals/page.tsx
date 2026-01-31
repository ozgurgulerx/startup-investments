import { Suspense } from 'react';
import { getMonthlyStats, getStartups } from '@/lib/data';

const DEFAULT_PERIOD = '2026-01';

// Pattern thesis descriptions
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

// Determine conviction level based on company count
function getConviction(count: number, total: number): 'high' | 'medium' | 'emerging' {
  const percentage = count / total;
  if (percentage > 0.15) return 'high';
  if (percentage > 0.08) return 'medium';
  return 'emerging';
}

async function SignalsContent() {
  const [stats, startups] = await Promise.all([
    getMonthlyStats(DEFAULT_PERIOD),
    getStartups(DEFAULT_PERIOD),
  ]);

  const totalDeals = stats.deal_summary.total_deals;

  // Get patterns with counts and notable companies
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const companies = startups
        .filter(s => s.build_patterns?.some(p => p.name === name))
        .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
        .slice(0, 5);

      const thesisData = PATTERN_THESIS[name] || {
        thesis: 'Emerging pattern in AI infrastructure.',
        enables: 'Potential to unlock new application categories.',
        risk: 'Limited data on long-term viability.',
        horizon: '12-24 months',
      };

      return {
        name,
        count,
        conviction: getConviction(count, totalDeals),
        companies,
        ...thesisData,
      };
    });

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <span className="briefing-date">Signals</span>
        <h1 className="briefing-headline">
          Architectural patterns shaping the next generation of AI infrastructure
        </h1>
        <p className="briefing-subhead">
          Analysis of {totalDeals} deals reveals conviction levels across {patterns.length} distinct build patterns.
        </p>
      </header>

      {/* Patterns List */}
      <div className="space-y-0">
        {patterns.slice(0, 8).map((pattern) => (
          <div key={pattern.name} className="signal-item">
            {/* Header */}
            <div className="signal-header">
              <h3 className="signal-name">{pattern.name}</h3>
              <div className="signal-conviction">
                <span className={`signal-conviction-dot ${pattern.conviction}`} />
                <span className="text-muted-foreground capitalize">
                  {pattern.conviction}
                </span>
              </div>
            </div>

            {/* Thesis */}
            <p className="signal-thesis">
              {pattern.thesis}
            </p>

            {/* What This Enables */}
            <div className="intel-callout">
              <span className="intel-callout-label">What This Enables</span>
              <p className="intel-callout-text">
                {pattern.enables}
              </p>
            </div>

            {/* Meta */}
            <div className="signal-meta mt-6">
              <div className="signal-meta-item">
                <span className="signal-meta-label">Time Horizon</span>
                <span className="signal-meta-value">{pattern.horizon}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Primary Risk</span>
                <span className="signal-meta-value max-w-xs">{pattern.risk}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Companies</span>
                <span className="signal-meta-value">{pattern.count}</span>
              </div>
            </div>

            {/* Notable Companies */}
            {pattern.companies.length > 0 && (
              <p className="body-sm mt-4">
                Notable: {pattern.companies.map(c => c.company_name).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
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

export default function SignalsPage() {
  return (
    <Suspense fallback={<SignalsLoading />}>
      <SignalsContent />
    </Suspense>
  );
}

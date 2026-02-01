import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompanyLogo } from '@/components/ui/company-logo';
import {
  ConfidenceBadge,
  AnalysisDepth,
  EvidenceCount,
} from '@/components/ui';
import { CompanyActions } from './company-actions';
import {
  getStartup,
  getStartupBrief,
  getAvailablePeriods,
  getStartups,
} from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

const DEFAULT_PERIOD = '2026-01';

// Pattern thesis data (shared with patterns page)
const PATTERN_CONTEXT: Record<string, {
  enables: string;
  risk: string;
  horizon: string;
}> = {
  'Agentic Architectures': {
    enables: 'Full workflow automation across legal, finance, and operations. Creates new category of "AI employees" that handle complex multi-step tasks.',
    risk: 'Reliability concerns in high-stakes environments may slow enterprise adoption.',
    horizon: '12-24 months',
  },
  'Vertical Data Moats': {
    enables: 'Unlocks AI applications in regulated industries where generic models fail. Creates acquisition targets for incumbents.',
    risk: 'Data licensing costs may erode margins. Privacy regulations could limit data accumulation.',
    horizon: '0-12 months',
  },
  'RAG (Retrieval-Augmented Generation)': {
    enables: 'Accelerates enterprise AI adoption by providing audit trails and source attribution.',
    risk: 'Pattern becoming table stakes. Differentiation shifting to retrieval quality.',
    horizon: '0-12 months',
  },
  'Micro-model Meshes': {
    enables: 'Cost-effective AI deployment for mid-market. Creates opportunity for specialized model providers.',
    risk: 'Orchestration complexity may outweigh benefits. Larger models may absorb capabilities.',
    horizon: '12-24 months',
  },
  'Continuous-learning Flywheels': {
    enables: 'Winner-take-most dynamics in categories where well-executed. Defensibility against well-funded competitors.',
    risk: 'Requires critical mass of users to generate meaningful signal.',
    horizon: '24+ months',
  },
  'Guardrail-as-LLM': {
    enables: 'Accelerates AI deployment in compliance-heavy industries. Creates new category of AI safety tooling.',
    risk: 'Adds latency and cost to inference. May become integrated into foundation model providers.',
    horizon: '0-12 months',
  },
};

// Generate editorial thesis from startup data
function generateThesis(startup: any): string {
  const isHorizontal = startup.market_type === 'horizontal';
  const vertical = startup.vertical?.replace(/_/g, ' ') || 'technology';
  const intensity = startup.genai_intensity || 'core';
  const stage = startup.funding_stage?.replace(/_/g, ' ') || 'early stage';
  const topPattern = startup.build_patterns?.[0]?.name || 'AI infrastructure';

  if (isHorizontal) {
    if (intensity === 'core') {
      return `${startup.company_name} is positioning as a ${stage} horizontal AI infrastructure play, building foundational capabilities around ${topPattern.toLowerCase()}.`;
    }
    return `${startup.company_name} represents a ${stage} bet on horizontal AI tooling, with ${intensity} GenAI integration across its product surface.`;
  }

  return `${startup.company_name} is applying ${topPattern.toLowerCase()} to ${vertical}, representing a ${stage} vertical AI play with ${intensity} generative AI integration.`;
}

// Generate "why now" context
function generateWhyNow(startup: any): string {
  const funding = startup.funding_amount || 0;
  const patterns = startup.build_patterns || [];
  const hasAgentic = patterns.some((p: any) => p.name.toLowerCase().includes('agentic'));
  const hasRAG = patterns.some((p: any) => p.name.toLowerCase().includes('rag'));
  const hasDataMoat = patterns.some((p: any) => p.name.toLowerCase().includes('data moat'));

  if (funding > 500000000) {
    return `The ${formatCurrency(funding, true)} raise signals strong investor conviction in ${startup.company_name}'s ability to capture meaningful market share during the current infrastructure buildout phase. Capital of this magnitude typically indicates expectations of category leadership.`;
  }

  if (hasAgentic) {
    return `As agentic architectures emerge as the dominant build pattern, ${startup.company_name} is positioned to benefit from enterprise demand for autonomous workflow solutions. The timing aligns with broader market readiness for AI systems that can execute multi-step tasks without human intervention.`;
  }

  if (hasDataMoat) {
    return `With foundation models commoditizing, ${startup.company_name}'s focus on domain-specific data creates potential for durable competitive advantage. First-mover advantage in data accumulation becomes increasingly valuable as the AI stack matures.`;
  }

  if (hasRAG) {
    return `Enterprise AI adoption is accelerating as retrieval-augmented approaches address hallucination concerns. ${startup.company_name} is entering a market with demonstrated buyer intent and clear ROI narratives.`;
  }

  return `${startup.company_name} enters a market characterized by significant capital deployment and growing enterprise adoption. The current funding environment favors companies with clear technical differentiation and defensible market positions.`;
}

// Generate implications text
function generateImplications(startup: any): string {
  const patterns = startup.build_patterns || [];
  const isHorizontal = startup.market_type === 'horizontal';
  const vertical = startup.vertical?.replace(/_/g, ' ') || 'the target market';

  if (isHorizontal) {
    return `If ${startup.company_name} achieves its technical roadmap, it could become foundational infrastructure for the next generation of AI applications. Success here would accelerate the timeline for downstream companies to build reliable, production-grade AI products. Failure or pivot would signal continued fragmentation in the AI tooling landscape.`;
  }

  const topPattern = patterns[0]?.name || 'this approach';
  return `${startup.company_name}'s execution will test whether ${topPattern.toLowerCase()} can deliver sustainable competitive advantage in ${vertical}. A successful outcome would validate the vertical AI thesis and likely trigger increased investment in similar plays. Incumbents in ${vertical} should monitor closely for early signs of customer adoption.`;
}

// Determine conviction level
function getConviction(pattern: any, totalPatterns: number): 'high' | 'medium' | 'emerging' {
  if (pattern.confidence > 0.8) return 'high';
  if (pattern.confidence > 0.5) return 'medium';
  return 'emerging';
}

interface PageProps {
  params: { slug: string };
}

async function CompanyBriefContent({ slug, period }: { slug: string; period: string }) {
  const [startup, brief, periods] = await Promise.all([
    getStartup(period, slug),
    getStartupBrief(period, slug),
    getAvailablePeriods(),
  ]);

  if (!startup) {
    notFound();
  }

  const thesis = generateThesis(startup);
  const whyNow = generateWhyNow(startup);
  const implications = generateImplications(startup);

  // Get competitive context
  const secretSauce = startup.competitive_analysis?.secret_sauce;
  const secretSauceText = typeof secretSauce === 'string'
    ? secretSauce
    : secretSauce?.core_advantage;

  const competitors = startup.competitive_analysis?.competitors?.slice(0, 3) || [];

  return (
    <>
      {/* Back navigation - quiet */}
      <Link
        href="/dealbook"
        className="inline-block text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        ← Dealbook
      </Link>

      {/* Section 1: Company Thesis Header */}
      <header className="briefing-header">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-4">
            {/* Company Logo - served from API */}
            <CompanyLogo
              slug={startup.company_slug}
              companyName={startup.company_name}
            />
            <h1 className="text-2xl font-light tracking-tight text-foreground">
              {startup.company_name}
            </h1>
            {startup.confidence_score !== undefined && (
              <ConfidenceBadge
                score={startup.confidence_score}
                size="lg"
                evidenceCount={startup.evidence_quotes?.length}
              />
            )}
          </div>
          <CompanyActions
            companySlug={startup.company_slug}
            companyName={startup.company_name}
          />
        </div>

        <p className="headline-md text-foreground/90 max-w-2xl mb-6 leading-relaxed">
          {thesis}
        </p>

        {/* Website link - prominent */}
        {startup.website && (
          <div className="flex items-center gap-2 mb-4">
            <a
              href={startup.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              {startup.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          </div>
        )}

        {/* Quiet metadata row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {startup.funding_stage && (
            <span>{startup.funding_stage.replace(/_/g, ' ')}</span>
          )}
          {startup.market_type === 'horizontal' ? (
            <span>Horizontal AI</span>
          ) : startup.vertical && (
            <span>{startup.vertical.replace(/_/g, ' ')}</span>
          )}
          {startup.uses_genai && startup.genai_intensity && (
            <span>GenAI: {startup.genai_intensity}</span>
          )}
          {startup.location && (
            <span>{startup.location}</span>
          )}
        </div>

        {/* Funding as context, not emphasis */}
        {startup.funding_amount && startup.funding_amount > 0 && (
          <div className="mt-6 pt-6 border-t border-border/40">
            <span className="num-lg text-foreground">
              {formatCurrency(startup.funding_amount, true)}
            </span>
            <span className="text-sm text-muted-foreground ml-3">
              raised
            </span>
          </div>
        )}
      </header>

      {/* Analysis Depth Indicator */}
      {(startup.raw_content_analyzed || startup.evidence_quotes?.length || startup.analyzed_at) && (
        <AnalysisDepth
          contentBytes={startup.raw_content_analyzed}
          quoteCount={startup.evidence_quotes?.length}
          analyzedAt={startup.analyzed_at}
          sources={startup.sources_crawled?.map((s: any) => typeof s === 'string' ? s : s.url)}
          className="mt-6"
        />
      )}

      {/* Section 2: Why This Company Matters Now */}
      <section className="section">
        <div className="section-header">
          <span className="section-title">Why This Matters Now</span>
        </div>

        <p className="body-lg max-w-2xl">
          {whyNow}
        </p>

        {/* Supporting context from description */}
        {startup.description && (
          <p className="body-md max-w-2xl mt-4">
            {startup.description}
          </p>
        )}

        {/* Key differentiator if available */}
        {secretSauceText && (
          <div className="intel-callout mt-6">
            <span className="intel-callout-label">Core Advantage</span>
            <p className="intel-callout-text">
              {secretSauceText}
            </p>
          </div>
        )}
      </section>

      {/* Section 3: Build Signals */}
      {startup.build_patterns && startup.build_patterns.length > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Build Signals</span>
            <Link href="/signals" className="section-link">
              Full pattern analysis
            </Link>
          </div>

          <div className="space-y-8">
            {startup.build_patterns.slice(0, 4).map((pattern: any, index: number) => {
              const conviction = getConviction(pattern, startup.build_patterns.length);
              const context = PATTERN_CONTEXT[pattern.name] || {
                enables: 'Emerging pattern with potential to unlock new application categories.',
                risk: 'Limited data on long-term viability in this context.',
                horizon: '12-24 months',
              };

              return (
                <div key={index} className="py-6 border-b border-border/30 last:border-0">
                  {/* Pattern header */}
                  <div className="flex items-start justify-between gap-8 mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="headline-sm">{pattern.name}</h3>
                      {pattern.evidence?.length > 0 && (
                        <EvidenceCount count={pattern.evidence.length} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm shrink-0">
                      <span className={`w-2 h-2 rounded-full ${
                        conviction === 'high' ? 'bg-foreground' :
                        conviction === 'medium' ? 'bg-muted-foreground' :
                        'bg-muted-foreground/40'
                      }`} />
                      <span className="text-muted-foreground capitalize">
                        {conviction}
                      </span>
                    </div>
                  </div>

                  {/* Pattern description/evidence */}
                  {pattern.description && (
                    <p className="body-md mb-4">
                      {pattern.description}
                    </p>
                  )}

                  {/* What this enables for this company */}
                  <div className="intel-callout">
                    <span className="intel-callout-label">What This Enables</span>
                    <p className="intel-callout-text">
                      {context.enables}
                    </p>
                  </div>

                  {/* Meta row */}
                  <div className="flex gap-8 mt-4 text-xs">
                    <div>
                      <span className="label-xs block mb-1">Time Horizon</span>
                      <span className="text-foreground/80">{context.horizon}</span>
                    </div>
                    <div className="max-w-xs">
                      <span className="label-xs block mb-1">Primary Risk</span>
                      <span className="text-foreground/80">{context.risk}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Tech Stack - prose style */}
      {((startup.models_mentioned?.length ?? 0) > 0 || (startup.tech_stack?.llm_models?.length ?? 0) > 0) && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Technical Foundation</span>
          </div>

          <p className="body-md max-w-2xl">
            {startup.company_name} builds on{' '}
            {[...new Set([
              ...(startup.models_mentioned || []),
              ...(startup.tech_stack?.llm_models || [])
            ])].slice(0, 3).join(', ')}
            {(startup.tech_stack?.llm_providers?.length ?? 0) > 0 && (
              <>, leveraging {startup.tech_stack?.llm_providers?.slice(0, 2).join(' and ')} infrastructure</>
            )}
            {(startup.tech_stack?.frameworks?.length ?? 0) > 0 && (
              <> with {startup.tech_stack?.frameworks?.slice(0, 2).join(', ')} in the stack</>
            )}.
            {startup.tech_stack?.approach && (
              <> The technical approach emphasizes {startup.tech_stack.approach.replace(/_/g, ' ')}.</>
            )}
          </p>
        </section>
      )}

      {/* Competitive Context - prose style */}
      {competitors.length > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Competitive Context</span>
          </div>

          <p className="body-md max-w-2xl mb-6">
            {startup.company_name} operates in a competitive landscape that includes{' '}
            {competitors.map((c: any) => c.name).join(', ')}.
          </p>

          <div className="space-y-4">
            {competitors.map((comp: any, i: number) => (
              <div key={i} className="py-3 border-b border-border/30 last:border-0">
                <span className="text-sm font-medium text-foreground">{comp.name}</span>
                {comp.how_different && (
                  <p className="body-sm mt-1">
                    Differentiation: {comp.how_different}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unique Findings - if available */}
      {startup.unique_findings && startup.unique_findings.length > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Notable Findings</span>
          </div>

          <div className="space-y-3">
            {startup.unique_findings.slice(0, 5).map((finding: string, i: number) => (
              <p key={i} className="body-md">
                {finding}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Warning Signs - if available, subdued */}
      {startup.anti_patterns && startup.anti_patterns.length > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Risk Factors</span>
          </div>

          <div className="space-y-4">
            {startup.anti_patterns.slice(0, 3).map((pattern: any, i: number) => (
              <div key={i} className="py-3 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-medium text-foreground capitalize">
                    {pattern.pattern_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {pattern.severity} severity
                  </span>
                </div>
                <p className="body-sm">
                  {pattern.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 4: Implications & Second-Order Effects */}
      <section className="section">
        <div className="intel-callout">
          <span className="intel-callout-label">What This Changes</span>
          <p className="intel-callout-text">
            {implications}
          </p>
        </div>
      </section>

      {/* Evidence quotes - collapsed by default */}
      {startup.evidence_quotes && startup.evidence_quotes.length > 0 && (
        <section className="section">
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
              <span className="label-xs">Source Evidence</span>
              <span className="ml-2 text-xs">({startup.evidence_quotes.length} quotes)</span>
            </summary>
            <div className="mt-4 space-y-3">
              {startup.evidence_quotes.slice(0, 6).map((quote: string, i: number) => (
                <blockquote
                  key={i}
                  className="pl-4 border-l border-border/50 text-sm text-muted-foreground italic"
                >
                  "{quote}"
                </blockquote>
              ))}
            </div>
          </details>
        </section>
      )}
    </>
  );
}

function CompanyBriefLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-4 w-32 bg-muted rounded" />
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="h-20 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-4">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-24 w-2/3 bg-muted rounded" />
      </div>
    </div>
  );
}

// Generate static params for all startups
export async function generateStaticParams() {
  const periods = await getAvailablePeriods();
  const allParams: { slug: string }[] = [];

  for (const periodInfo of periods) {
    const startups = await getStartups(periodInfo.period);
    for (const startup of startups) {
      if (startup.company_slug && !allParams.find(p => p.slug === startup.company_slug)) {
        allParams.push({ slug: startup.company_slug });
      }
    }
  }

  return allParams;
}

export default function CompanyBriefPage({ params }: PageProps) {
  return (
    <Suspense fallback={<CompanyBriefLoading />}>
      <CompanyBriefContent slug={params.slug} period={DEFAULT_PERIOD} />
    </Suspense>
  );
}

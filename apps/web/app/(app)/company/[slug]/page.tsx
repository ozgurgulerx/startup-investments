import { Suspense } from 'react';
import Link from 'next/link';
import { CompanyLogo } from '@/components/ui/company-logo';
import {
  ConfidenceBadge,
  AnalysisDepth,
  EvidenceCount,
  FailureModeTag,
  FailureModeSummary,
} from '@/components/ui';
import { CompanyActions } from './company-actions';
import {
  getStartup,
  getAvailablePeriods,
  getStartups,
} from '@/lib/data';
import { formatCurrency } from '@/lib/utils';

const FALLBACK_PERIOD = '2026-01';

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

async function CompanyBriefContent({ slug }: { slug: string }) {
  // Dynamically resolve latest period
  const availablePeriods = await getAvailablePeriods();
  const period = availablePeriods[0]?.period || FALLBACK_PERIOD;

  const startup = await getStartup(period, slug);

  if (!startup) {
    // Don't 404: the dealbook can show records that don't yet have full analysis materialized.
    return (
      <>
        <Link
          href="/dealbook"
          className="inline-block text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          ← Dealbook
        </Link>
        <header className="briefing-header">
          <h1 className="text-2xl font-light tracking-tight text-foreground">
            {slug}
          </h1>
          <p className="headline-md text-foreground/90 max-w-2xl mb-6 leading-relaxed">
            This company is in the dealbook, but its full dossier is not available yet.
          </p>
        </header>
      </>
    );
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
              size="lg"
              variant="elevated"
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
            {startup.anti_patterns && startup.anti_patterns.length > 0 && (
              <FailureModeSummary antiPatterns={startup.anti_patterns} />
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

      {/* Model Architecture - NEW */}
      {startup.model_details && (
        startup.model_details.primary_models?.length > 0 ||
        startup.model_details.fine_tuning?.uses_fine_tuning ||
        startup.model_details.compound_ai?.is_compound_system ||
        startup.model_details.model_routing?.uses_routing
      ) && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Model Architecture</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Primary Models */}
            {startup.model_details.primary_models?.length > 0 && (
              <div className="space-y-2">
                <span className="label-xs">Primary Models</span>
                <div className="flex flex-wrap gap-2">
                  {startup.model_details.primary_models.map((model: string, i: number) => (
                    <span key={i} className="px-2 py-1 text-xs bg-muted/50 rounded text-foreground/80">
                      {model}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Fine-tuning */}
            {startup.model_details.fine_tuning?.uses_fine_tuning && (
              <div className="space-y-2">
                <span className="label-xs">Fine-tuning</span>
                <p className="body-sm">
                  {startup.model_details.fine_tuning.fine_tuning_approach || 'Custom fine-tuning'}
                  {startup.model_details.fine_tuning.training_data_source && (
                    <span className="text-muted-foreground">
                      {' '}— {startup.model_details.fine_tuning.training_data_source}
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* Compound AI */}
            {startup.model_details.compound_ai?.is_compound_system && (
              <div className="space-y-2">
                <span className="label-xs">Compound AI System</span>
                <p className="body-sm">
                  {startup.model_details.compound_ai.orchestration_pattern || 'Multi-model orchestration'}
                </p>
              </div>
            )}

            {/* Model Routing */}
            {startup.model_details.model_routing?.uses_routing && (
              <div className="space-y-2">
                <span className="label-xs">Model Routing</span>
                <p className="body-sm">
                  {startup.model_details.model_routing.routing_strategy || 'Dynamic model selection'}
                </p>
              </div>
            )}

            {/* Inference Optimization */}
            {startup.model_details.inference_optimization?.length > 0 && (
              <div className="space-y-2">
                <span className="label-xs">Inference Optimization</span>
                <div className="flex flex-wrap gap-2">
                  {startup.model_details.inference_optimization.map((opt: string, i: number) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      {opt}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Team Analysis - NEW */}
      {startup.team_analysis && (
        startup.team_analysis.founders?.length > 0 ||
        startup.team_analysis.team_strengths?.length > 0 ||
        startup.team_analysis.founder_market_fit
      ) && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Team</span>
          </div>

          {/* Founders */}
          {startup.team_analysis.founders?.length > 0 && (
            <div className="space-y-4 mb-6">
              {startup.team_analysis.founders.slice(0, 3).map((founder: any, i: number) => (
                <div key={i} className="py-3 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{founder.name}</span>
                    {founder.role && (
                      <span className="text-xs text-muted-foreground">• {founder.role}</span>
                    )}
                    {founder.technical_depth && founder.technical_depth !== 'unknown' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        founder.technical_depth === 'high' ? 'bg-foreground/10 text-foreground' :
                        founder.technical_depth === 'medium' ? 'bg-muted text-muted-foreground' :
                        'bg-muted/50 text-muted-foreground'
                      }`}>
                        {founder.technical_depth} technical
                      </span>
                    )}
                  </div>
                  {founder.background && (
                    <p className="body-sm">{founder.background}</p>
                  )}
                  {founder.previous_companies?.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Previously: {founder.previous_companies.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Founder-Market Fit */}
          {startup.team_analysis.founder_market_fit && (
            <div className="intel-callout mb-4">
              <span className="intel-callout-label">Founder-Market Fit</span>
              <p className="intel-callout-text">{startup.team_analysis.founder_market_fit}</p>
            </div>
          )}

          {/* Team Signals */}
          {startup.team_analysis.team_signals && (
            <div className="flex flex-wrap gap-3 text-xs">
              {startup.team_analysis.team_signals.engineering_heavy && (
                <span className="px-2 py-1 bg-muted/50 rounded">Engineering-heavy</span>
              )}
              {startup.team_analysis.team_signals.has_ml_expertise && (
                <span className="px-2 py-1 bg-muted/50 rounded">ML expertise</span>
              )}
              {startup.team_analysis.team_signals.has_domain_expertise && (
                <span className="px-2 py-1 bg-muted/50 rounded">Domain expertise</span>
              )}
              {startup.team_analysis.team_signals.hiring_signals?.map((signal: string, i: number) => (
                <span key={i} className="px-2 py-1 bg-muted/30 rounded text-muted-foreground">
                  Hiring: {signal}
                </span>
              ))}
            </div>
          )}

          {/* Team Red Flags */}
          {startup.team_analysis.team_red_flags?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/30">
              <span className="label-xs text-amber-500/80">Considerations</span>
              <ul className="mt-2 space-y-1">
                {startup.team_analysis.team_red_flags.map((flag: string, i: number) => (
                  <li key={i} className="text-xs text-muted-foreground">• {flag}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Business Model - NEW */}
      {startup.business_model && (
        startup.business_model.gtm_strategy?.primary_channel !== 'unknown' ||
        startup.business_model.pricing_model?.type !== 'unknown' ||
        startup.business_model.distribution_advantages?.length > 0
      ) && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Business Model</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* GTM Strategy */}
            {startup.business_model.gtm_strategy?.primary_channel &&
             startup.business_model.gtm_strategy.primary_channel !== 'unknown' && (
              <div className="space-y-2">
                <span className="label-xs">Go-to-Market</span>
                <p className="text-sm font-medium text-foreground">
                  {startup.business_model.gtm_strategy.primary_channel.replace(/_/g, ' ')}
                </p>
                {startup.business_model.gtm_strategy.target_segment &&
                 startup.business_model.gtm_strategy.target_segment !== 'unknown' && (
                  <p className="text-xs text-muted-foreground">
                    Target: {startup.business_model.gtm_strategy.target_segment.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            )}

            {/* Pricing Model */}
            {startup.business_model.pricing_model?.type &&
             startup.business_model.pricing_model.type !== 'unknown' && (
              <div className="space-y-2">
                <span className="label-xs">Pricing</span>
                <p className="text-sm font-medium text-foreground">
                  {startup.business_model.pricing_model.type.replace(/_/g, ' ')}
                </p>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  {startup.business_model.pricing_model.free_tier_available && (
                    <span>Free tier</span>
                  )}
                  {startup.business_model.pricing_model.enterprise_focus && (
                    <span>Enterprise focus</span>
                  )}
                </div>
              </div>
            )}

            {/* Sales Motion */}
            {startup.business_model.gtm_strategy?.sales_motion &&
             startup.business_model.gtm_strategy.sales_motion !== 'unknown' && (
              <div className="space-y-2">
                <span className="label-xs">Sales Motion</span>
                <p className="text-sm font-medium text-foreground">
                  {startup.business_model.gtm_strategy.sales_motion.replace(/_/g, ' ')}
                </p>
              </div>
            )}
          </div>

          {/* Distribution Advantages */}
          {startup.business_model.distribution_advantages?.length > 0 && (
            <div className="intel-callout">
              <span className="intel-callout-label">Distribution Advantages</span>
              <ul className="intel-callout-text space-y-1">
                {startup.business_model.distribution_advantages.map((adv: string, i: number) => (
                  <li key={i}>• {adv}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Customer Proof Points */}
          {(startup.business_model.customer_acquisition?.customer_proof_points?.length ?? 0) > 0 && (
            <div className="mt-4 pt-4 border-t border-border/30">
              <span className="label-xs">Customer Evidence</span>
              <div className="mt-2 space-y-1">
                {startup.business_model.customer_acquisition!.customer_proof_points!.slice(0, 3).map((point: string, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">• {point}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Product Analysis - NEW */}
      {startup.product_analysis && (
        startup.product_analysis.product_stage !== 'unknown' ||
        (startup.product_analysis.feature_depth?.core_features?.length ?? 0) > 0 ||
        (startup.product_analysis.integration_ecosystem?.integrations_mentioned?.length ?? 0) > 0
      ) && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Product</span>
          </div>

          {/* Product Stage */}
          {startup.product_analysis.product_stage && startup.product_analysis.product_stage !== 'unknown' && (
            <div className="flex items-center gap-3 mb-4">
              <span className="label-xs">Stage:</span>
              <span className={`px-2 py-1 text-xs rounded ${
                startup.product_analysis.product_stage === 'mature' ? 'bg-foreground/10 text-foreground' :
                startup.product_analysis.product_stage === 'general_availability' ? 'bg-muted text-foreground/80' :
                startup.product_analysis.product_stage === 'beta' ? 'bg-muted/50 text-muted-foreground' :
                'bg-muted/30 text-muted-foreground'
              }`}>
                {startup.product_analysis.product_stage.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Core Features */}
          {(startup.product_analysis.feature_depth?.differentiating_features?.length ?? 0) > 0 && (
            <div className="mb-4">
              <span className="label-xs">Differentiating Features</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {startup.product_analysis.feature_depth!.differentiating_features!.slice(0, 5).map((feature: string, i: number) => (
                  <span key={i} className="px-2 py-1 text-xs bg-accent/10 text-accent rounded">
                    {feature}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Integrations */}
          {(startup.product_analysis.integration_ecosystem?.integrations_mentioned?.length ?? 0) > 0 && (
            <div className="mb-4">
              <span className="label-xs">Integrations</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {startup.product_analysis.integration_ecosystem!.integrations_mentioned!.slice(0, 6).map((integration: string, i: number) => (
                  <span key={i} className="text-xs text-muted-foreground">
                    {integration}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Use Cases */}
          {startup.product_analysis.use_cases?.primary_use_case && (
            <div className="intel-callout">
              <span className="intel-callout-label">Primary Use Case</span>
              <p className="intel-callout-text">{startup.product_analysis.use_cases.primary_use_case}</p>
            </div>
          )}
        </section>
      )}

      {/* Discovered Patterns - NEW (high-novelty patterns) */}
      {(startup.discovered_patterns?.length ?? 0) > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Novel Approaches</span>
          </div>

          <div className="space-y-4">
            {startup.discovered_patterns!
              .filter((p: any) => p.novelty_score >= 7)
              .slice(0, 3)
              .map((pattern: any, i: number) => (
                <div key={i} className="py-3 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-foreground">{pattern.pattern_name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-accent/10 text-accent rounded">
                      Novelty: {pattern.novelty_score}/10
                    </span>
                    <span className="text-xs text-muted-foreground">{pattern.category}</span>
                  </div>
                  {pattern.why_notable && (
                    <p className="body-sm">{pattern.why_notable}</p>
                  )}
                </div>
              ))}
          </div>
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

      {/* Risk Factors - using FailureModeTag for consistent display */}
      {startup.anti_patterns && startup.anti_patterns.length > 0 && (
        <section className="section">
          <div className="section-header">
            <span className="section-title">Risk Factors</span>
          </div>

          <div className="space-y-3">
            {startup.anti_patterns.slice(0, 4).map((pattern: any, i: number) => (
              <FailureModeTag
                key={i}
                patternType={pattern.pattern_type}
                severity={pattern.severity}
                description={pattern.description}
                evidence={pattern.evidence}
              />
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
                  &ldquo;{quote}&rdquo;
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
  const slugSet = new Set<string>();

  for (const periodInfo of periods) {
    const startups = await getStartups(periodInfo.period);
    for (const startup of startups) {
      if (startup.company_slug) {
        slugSet.add(startup.company_slug);
      }
    }
  }

  return Array.from(slugSet).map((slug) => ({ slug }));
}

export default function CompanyBriefPage({ params }: PageProps) {
  return (
    <Suspense fallback={<CompanyBriefLoading />}>
      <CompanyBriefContent slug={params.slug} />
    </Suspense>
  );
}

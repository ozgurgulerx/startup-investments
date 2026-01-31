/**
 * Monthly Brief Generator
 *
 * Generates a structured monthly_brief.json from existing data sources.
 * This can be run as a build step or called dynamically.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { MonthlyBrief } from '../types/monthly-brief';
import { getMonthlyStats, getStartups, getAvailablePeriods } from './index';
import { formatCurrency } from '../utils';

const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data');

/**
 * Get monthly brief - reads from pre-generated file for performance
 * Falls back to dynamic generation if file doesn't exist
 */
export async function getMonthlyBrief(period: string): Promise<MonthlyBrief> {
  const briefPath = path.join(DATA_PATH, period, 'output', 'monthly_brief.json');

  try {
    const content = await fs.readFile(briefPath, 'utf-8');
    return JSON.parse(content) as MonthlyBrief;
  } catch {
    // Fall back to dynamic generation if file doesn't exist
    console.log(`Pre-generated brief not found for ${period}, generating dynamically...`);
    return generateMonthlyBrief(period);
  }
}

// Stage name normalization
const STAGE_LABELS: Record<string, string> = {
  series_d_plus: 'Series D+',
  series_c: 'Series C',
  series_b: 'Series B',
  series_a: 'Series A',
  seed: 'Seed',
  pre_seed: 'Pre-Seed',
  unknown: 'Other',
};

// Region name normalization
const REGION_LABELS: Record<string, string> = {
  north_america: 'North America',
  asia: 'Asia',
  europe: 'Europe',
  oceania: 'Oceania',
  africa: 'Africa',
  south_america: 'South America',
};

// City name normalization
function formatCityName(city: string): string {
  return city
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format month display name
 */
function formatMonthDisplay(period: string): { month: string; year: string } {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  const monthName = date.toLocaleString('en-US', { month: 'long' });
  return { month: monthName, year };
}

/**
 * Generate the complete monthly brief from existing data
 */
export async function generateMonthlyBrief(period: string): Promise<MonthlyBrief> {
  const [stats, startups] = await Promise.all([
    getMonthlyStats(period),
    getStartups(period),
  ]);

  const { month, year } = formatMonthDisplay(period);
  const totalFunding = stats.deal_summary.total_funding_usd;
  const genaiAdoptionPct = Math.round(stats.genai_analysis.genai_adoption_rate * 100);

  // Find largest deal
  const largestDeal = stats.top_deals[0];

  // Build pattern landscape with signals
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([pattern, count]) => {
      const prevalencePct = Math.round((count / stats.genai_analysis.total_analyzed) * 100);
      return {
        pattern,
        prevalencePct,
        startupCount: count,
        signal: getPatternSignal(pattern, prevalencePct),
      };
    });

  // Build funding by stage
  const totalStageFunding = Object.values(stats.funding_by_stage).reduce(
    (sum, s) => sum + s.total_usd,
    0
  );

  const fundingByStage = Object.entries(stats.funding_by_stage)
    .map(([stage, data]) => ({
      stage: STAGE_LABELS[stage] || stage,
      amount: data.total_usd,
      pct: Math.round((data.total_usd / totalStageFunding) * 100),
      deals: data.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Build top deals (top 10)
  const topDeals = stats.top_deals.slice(0, 10).map((deal, index) => {
    const startup = startups.find(
      s => s.company_name.toLowerCase() === deal.name.toLowerCase()
    );
    return {
      rank: index + 1,
      company: deal.name,
      slug: startup?.company_slug || deal.name.toLowerCase().replace(/\s+/g, '-'),
      amount: deal.funding_usd,
      stage: deal.stage,
      location: formatLocation(deal.location),
      vertical: startup?.vertical,
    };
  });

  // Build geographic distribution
  const geography = Object.entries(stats.funding_by_continent)
    .map(([region, data]) => ({
      region: REGION_LABELS[region] || formatCityName(region),
      deals: data.count,
      totalFunding: data.total_usd,
      avgDeal: data.avg_usd,
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding);

  // US Dominance - California stats
  const californiaData = stats.funding_by_us_state?.california;
  const californiaCities = Object.entries(stats.funding_by_city)
    .filter(([city]) => isCaliforniaCity(city))
    .map(([city, data]) => ({
      city: formatCityName(city),
      deals: data.count,
      totalFunding: data.total_usd,
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding)
    .slice(0, 5);

  // Emerging hubs (non-US cities with significant funding)
  const emergingHubs = Object.entries(stats.funding_by_city)
    .filter(([city]) => !isUSCity(city) && !['singapore'].includes(city))
    .map(([city, data]) => ({
      city: formatCityName(city),
      totalFunding: data.total_usd,
      deals: data.count,
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding)
    .slice(0, 5);

  // Investor intelligence
  const mostActiveInvestors = stats.top_investors
    .filter(inv => inv.deal_count >= 2)
    .slice(0, 5)
    .map(inv => ({
      name: inv.name,
      deals: inv.deal_count,
      totalDeployed: inv.total_invested,
      notableBets: getNotableBets(inv.name, startups),
    }));

  const megaCheckWriters = stats.top_investors
    .filter(inv => inv.total_invested >= 100_000_000)
    .slice(0, 5)
    .map(inv => ({
      name: inv.name,
      singleInvestment: inv.total_invested,
      company: findCompanyForInvestor(inv.name, stats.top_deals),
    }));

  // Find spotlight company (largest non-xAI deal or highest newsletter_potential)
  const spotlightStartup = findSpotlightCompany(startups, stats.top_deals);
  const spotlight = spotlightStartup
    ? {
        company: spotlightStartup.company_name,
        slug: spotlightStartup.company_slug,
        amount: spotlightStartup.funding_amount || 0,
        stage: spotlightStartup.funding_stage || 'Unknown',
        location: spotlightStartup.location || 'Unknown',
        vertical: spotlightStartup.vertical || 'Unknown',
        whyThisMatters: generateWhyThisMatters(spotlightStartup),
        technicalBet: spotlightStartup.description?.slice(0, 200),
        buildPatterns:
          spotlightStartup.build_patterns?.map((p: { name: string }) => p.name).slice(0, 4) || [],
        risk: generateRisk(spotlightStartup),
        builderTakeaway: generateBuilderTakeaway(spotlightStartup),
      }
    : undefined;

  // Generate LLM-style content (deterministic for now, can be enhanced with actual LLM)
  const executiveSummary = generateExecutiveSummary(
    stats.deal_summary.total_deals,
    totalFunding,
    genaiAdoptionPct,
    patterns[0]?.pattern || 'Vertical Data Moats'
  );

  const theme = {
    name: 'The Specialization Era',
    summaryBullets: [
      `Generic AI wrappers are dying. ${patterns[0]?.startupCount || 0} of ${stats.genai_analysis.total_analyzed} startups are building ${patterns[0]?.pattern?.toLowerCase() || 'vertical solutions'}.`,
      `Agentic architectures are becoming the baseline—${patterns.find(p => p.pattern.includes('Agentic'))?.prevalencePct || 0}% of funded startups building for autonomous AI.`,
      `Trust infrastructure is the next frontier. Guardrails and safety layers are the fastest-growing pattern category.`,
      `Late-stage dominates dollars (${fundingByStage[0]?.pct || 0}%), but seed dominates deal count (${fundingByStage.find(s => s.stage === 'Seed')?.deals || 0} deals).`,
    ],
  };

  const builderLessons = [
    {
      title: 'Vertical Data Moats Win',
      text: `${patterns[0]?.prevalencePct || 90}% of funded startups are building industry-specific data advantages. Generic solutions without proprietary data are struggling to differentiate.`,
      howToApply:
        'Identify a narrow vertical. Build data collection into your core loop. Make your product better with every customer interaction.',
    },
    {
      title: 'Agentic is the New Table Stakes',
      text: `With ${patterns.find(p => p.pattern.includes('Agentic'))?.prevalencePct || 66}% adoption, autonomous AI architectures are no longer differentiators—they're expected.`,
      howToApply:
        'Design for agent-first workflows. Build APIs that agents can call. Think about tool use, not just chat interfaces.',
    },
    {
      title: 'Trust Infrastructure Matters',
      text: 'Guardrail and safety layers are growing faster than any other pattern. Enterprise buyers are demanding AI governance.',
      howToApply:
        'Build observability and audit trails from day one. Consider guardrails as a feature, not an afterthought.',
    },
  ];

  const whatWatching = [
    'Voice AI consolidation: Deepgram, Parloa, and Listen Labs are defining the voice stack',
    'Robotics foundation models: Skild AI\'s $1.4B signals massive appetite for physical AI',
    'AI hardware specialization: Etched\'s transformer-specific ASICs could reshape inference economics',
    'Enterprise AI governance: Trust and compliance layers becoming standard requirements',
    `Geographic diversification: ${emergingHubs[0]?.city || 'Berlin'} and Singapore emerging as AI hubs outside the US`,
  ];

  const methodology = {
    bullets: [
      `${stats.deal_summary.total_deals} funding rounds analyzed for ${month} ${year}`,
      'AI-powered pattern detection across public company information',
    ],
    dataSources: [],
  };

  return {
    monthKey: period,
    title: `${month} ${year} Intelligence Brief`,
    subtitle: "The AI Builder's Intelligence Brief",
    hook: `What ${formatCurrency(totalFunding, true)} in AI funding reveals about where the industry is actually heading.`,
    generatedAt: new Date().toISOString(),
    executiveSummary,
    metrics: {
      totalFunding,
      totalDeals: stats.deal_summary.total_deals,
      avgDeal: stats.deal_summary.average_deal_size,
      medianDeal: stats.deal_summary.median_deal_size,
      largestDeal: {
        company: largestDeal?.name || 'Unknown',
        amount: largestDeal?.funding_usd || 0,
        stage: largestDeal?.stage || 'Unknown',
      },
      genaiAdoptionPct,
    },
    theme,
    patternLandscape: patterns,
    fundingByStage,
    topDeals,
    geography,
    usDominance: {
      californiaTotal: californiaData?.total_usd || 0,
      californiaPct: californiaData
        ? Math.round((californiaData.total_usd / totalFunding) * 100)
        : 0,
      cities: californiaCities,
    },
    emergingHubs,
    investors: {
      mostActive: mostActiveInvestors,
      megaCheckWriters,
    },
    spotlight,
    builderLessons,
    whatWatching,
    methodology,
  };
}

// Helper functions

function formatLocation(location: string): string {
  if (!location) return 'Unknown';
  const parts = location.split(',').map(p => p.trim());
  // Return city, state/country format
  return parts.slice(0, 2).join(', ');
}

function getPatternSignal(pattern: string, prevalence: number): string {
  const signals: Record<string, string> = {
    'Vertical Data Moats': 'Industry-specific data is the new moat',
    'Agentic Architectures': 'Autonomous AI becoming standard',
    'Continuous-learning Flywheels': 'Usage data improving models',
    'Micro-model Meshes': 'Specialized models > one big model',
    'Guardrail-as-LLM': 'Security layer market emerging',
    'RAG (Retrieval-Augmented Generation)': 'Document search + LLM is table stakes',
    'Natural-Language-to-Code': 'Code generation reaching maturity',
    'Knowledge Graphs': 'Structured knowledge for AI reasoning',
  };
  return signals[pattern] || `${prevalence}% of startups using this pattern`;
}

function isCaliforniaCity(city: string): boolean {
  const caCities = [
    'palo_alto',
    'san_francisco',
    'mountain_view',
    'cupertino',
    'redwood_city',
    'menlo_park',
    'santa_clara',
    'san_jose',
    'oakland',
    'south_san_francisco',
    'pleasanton',
    'sunnyvale',
    'santa_monica',
    'los_angeles',
    'san_diego',
    'beverly_hills',
    'stanford',
  ];
  return caCities.includes(city.toLowerCase());
}

function isUSCity(city: string): boolean {
  // Simplified check - would need a proper US city list
  const usCities = [
    'new_york',
    'chicago',
    'boston',
    'seattle',
    'austin',
    'denver',
    'pittsburgh',
    'washington',
    'miami',
    'dallas',
    'houston',
    'atlanta',
    'salt_lake_city',
    'minneapolis',
    'raleigh',
    'cambridge',
  ];
  return isCaliforniaCity(city) || usCities.includes(city.toLowerCase());
}

function getNotableBets(investorName: string, startups: any[]): string {
  // Find startups backed by this investor
  const backed = startups
    .filter(s => s.investors?.includes(investorName))
    .slice(0, 2)
    .map(s => s.company_name);
  return backed.length > 0 ? backed.join(', ') : 'Early-stage AI';
}

function findCompanyForInvestor(
  investorName: string,
  topDeals: any[]
): string {
  // Find the deal associated with this investor
  // This is a simplified heuristic
  return topDeals[0]?.name || 'Various';
}

function findSpotlightCompany(startups: any[], topDeals: any[]): any {
  // Find the most interesting company for spotlight
  // Exclude xAI (too dominant), find highest newsletter_potential
  const sorted = startups
    .filter(
      s =>
        s.company_name !== 'xAI' &&
        s.newsletter_potential === 'high' &&
        (s.funding_amount || 0) >= 100_000_000
    )
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));

  return sorted[0] || startups.find(s => s.company_name === 'Skild AI');
}

function generateWhyThisMatters(startup: any): string {
  const vertical = startup.vertical || 'technology';
  const patterns = startup.build_patterns?.map((p: any) => p.name).slice(0, 2) || [];
  return `${startup.company_name} is building ${patterns[0]?.toLowerCase() || 'advanced AI'} for the ${vertical} sector. This represents a significant bet on the future of specialized AI infrastructure.`;
}

function generateRisk(startup: any): string {
  return `Competition from well-funded incumbents and big tech. Execution risk in a rapidly evolving market.`;
}

function generateBuilderTakeaway(startup: any): string {
  return `Watch for ecosystem effects. If ${startup.company_name} succeeds, it creates opportunities for complementary solutions.`;
}

function generateExecutiveSummary(
  totalDeals: number,
  totalFunding: number,
  genaiPct: number,
  topPattern: string
): string {
  const fundingStr = formatCurrency(totalFunding, true);
  return `This month we analyzed ${totalDeals} AI startup funding rounds totaling ${fundingStr}—one of the largest monthly cohorts we've tracked. The data reveals a market in transition: the "general-purpose AI" era is giving way to deeply specialized, vertically-integrated solutions. ${genaiPct}% of funded startups are building with generative AI, with ${topPattern.toLowerCase()} emerging as the dominant build pattern. Here's what builders need to know.`;
}

/**
 * Get or generate monthly brief for a period
 * First tries to load from static file, falls back to generation
 */
export async function getMonthlyBrief(period: string): Promise<MonthlyBrief> {
  // Try to load from static file first
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const dataPath = process.env.DATA_PATH || path.join(process.cwd(), 'data');
    const briefPath = path.join(dataPath, period, 'output', 'monthly_brief.json');

    const data = await fs.readFile(briefPath, 'utf-8');
    return JSON.parse(data) as MonthlyBrief;
  } catch {
    // Fall back to dynamic generation
    return generateMonthlyBrief(period);
  }
}

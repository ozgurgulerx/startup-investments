/**
 * Generate static briefing JSON files for client-side month switching
 * Run this during build: npx tsx scripts/generate-briefings.ts
 */

import { promises as fs } from 'fs';
import path from 'path';

interface FundingBucket {
  count: number;
  total_usd: number;
  avg_usd: number;
}

interface MonthlyStats {
  period: string;
  deal_summary: {
    total_deals: number;
    total_funding_usd: number;
    average_deal_size: number;
  };
  genai_analysis: {
    genai_adoption_rate: number;
    pattern_distribution: Record<string, number>;
    total_analyzed: number;
  };
  funding_by_continent: Record<string, FundingBucket>;
}

interface StartupAnalysis {
  company_name: string;
  company_slug: string;
  funding_amount?: number;
  vertical?: string;
  market_type?: string;
  build_patterns?: Array<{ name: string }>;
}

interface BriefingData {
  period: string;
  insight: string;
  context: string;
  stats: {
    totalFunding: number;
    totalDeals: number;
    genaiAdoptionRate: number;
  };
  topDeals: Array<{
    slug: string;
    name: string;
    vertical: string;
    funding: number;
  }>;
  topPatterns: Array<{
    name: string;
    count: number;
    companies: string[];
  }>;
  geographicDistribution: Array<{
    region: string;
    amount: number;
    percentage: number;
  }>;
}

const DATA_PATH = path.join(process.cwd(), 'data');
const OUTPUT_PATH = path.join(process.cwd(), 'public', 'data', 'briefings');
const BRIEFS_PATH = path.join(process.cwd(), 'public', 'data', 'briefs');
const FORCE_REGEN = process.env.FORCE_REGEN_BRIEFINGS === 'true';
const GENERATE_LEGACY = process.env.GENERATE_LEGACY_BRIEFINGS !== 'false';

function formatCurrency(value: number): string {
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(1)}B`;
  }
  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(0)}M`;
  }
  return `$${value.toLocaleString()}`;
}

function formatVerticalName(vertical: string): string {
  const names: Record<string, string> = {
    horizontal: 'AI & Machine Learning',
    healthcare: 'Healthcare',
    developer_tools: 'Developer Tools',
    enterprise_saas: 'Enterprise SaaS',
    marketing: 'Marketing',
    financial_services: 'Fintech',
    legal: 'LegalTech',
    cybersecurity: 'Cybersecurity',
    industrial: 'Industrial',
    education: 'Education',
    consumer: 'Consumer',
    ecommerce: 'E-commerce',
    hr_recruiting: 'HR & Recruiting',
    media_content: 'Media',
    other: 'Other',
  };
  return names[vertical] || vertical.replace(/_/g, ' ');
}

async function getMonthlyStats(period: string): Promise<MonthlyStats> {
  const filePath = path.join(DATA_PATH, period, 'output', 'monthly_stats.json');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function getStartups(period: string): Promise<StartupAnalysis[]> {
  const storePath = path.join(DATA_PATH, period, 'output', 'analysis_store');
  const indexPath = path.join(storePath, 'index.json');

  try {
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);
    const startups: StartupAnalysis[] = [];

    for (const [, info] of Object.entries(index.startups || {})) {
      const startupInfo = info as { slug: string; has_base: boolean };
      if (startupInfo.has_base) {
        try {
          const basePath = path.join(storePath, 'base_analyses', `${startupInfo.slug}.json`);
          const baseContent = await fs.readFile(basePath, 'utf-8');
          startups.push(JSON.parse(baseContent));
        } catch {
          // Skip if can't read
        }
      }
    }

    return startups.sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));
  } catch {
    return [];
  }
}

async function getAvailablePeriods(): Promise<string[]> {
  const entries = await fs.readdir(DATA_PATH, { withFileTypes: true });
  const periods: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
      try {
        await getMonthlyStats(entry.name);
        periods.push(entry.name);
      } catch {
        // Period exists but no stats
      }
    }
  }

  return periods.sort((a, b) => b.localeCompare(a));
}

async function getMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

async function getPeriodInputMtime(period: string): Promise<number> {
  const monthlyStatsPath = path.join(DATA_PATH, period, 'output', 'monthly_stats.json');
  const indexPath = path.join(DATA_PATH, period, 'output', 'analysis_store', 'index.json');
  const [statsMtime, indexMtime] = await Promise.all([
    getMtimeMs(monthlyStatsPath),
    getMtimeMs(indexPath),
  ]);
  return Math.max(statsMtime, indexMtime);
}

async function isPeriodUpToDate(period: string): Promise<boolean> {
  const inputMtime = await getPeriodInputMtime(period);
  if (!inputMtime) return false;

  const legacyOutput = path.join(OUTPUT_PATH, `${period}.json`);
  const briefOutput = path.join(BRIEFS_PATH, `${period}.json`);
  const serverOutput = path.join(DATA_PATH, period, 'output', 'monthly_brief.json');

  const outputPaths = GENERATE_LEGACY ? [legacyOutput, briefOutput, serverOutput] : [briefOutput, serverOutput];
  const mtimes = await Promise.all(outputPaths.map((outPath) => getMtimeMs(outPath)));
  if (mtimes.some((value) => value <= 0)) return false;

  return mtimes.every((value) => value >= inputMtime);
}

function generateInsight(stats: MonthlyStats): string {
  const genaiRate = Math.round(stats.genai_analysis.genai_adoption_rate * 100);
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1]);
  const topPattern = patterns[0]?.[0] || 'agentic architectures';

  if (genaiRate > 50) {
    return `Capital concentrated around ${topPattern.toLowerCase()}, with ${genaiRate}% of funded startups building on generative AI infrastructure.`;
  }
  return `Investment activity signals growing conviction in ${topPattern.toLowerCase()} as the dominant build pattern this period.`;
}

function generateContext(stats: MonthlyStats): string {
  const avgDeal = stats.deal_summary.average_deal_size;
  const avgDealFormatted = formatCurrency(avgDeal);

  return `Average deal size reached ${avgDealFormatted}, suggesting investors are concentrating bets on fewer, more capital-intensive infrastructure plays rather than spreading across application layer experiments.`;
}

async function generateBriefing(period: string): Promise<BriefingData> {
  const [stats, startups] = await Promise.all([
    getMonthlyStats(period),
    getStartups(period),
  ]);

  // Top deals
  const topDeals = startups
    .filter(s => s.funding_amount && s.funding_amount > 0)
    .slice(0, 10)
    .map(s => ({
      slug: s.company_slug,
      name: s.company_name,
      vertical: formatVerticalName(s.market_type === 'horizontal' ? 'horizontal' : (s.vertical || 'other')),
      funding: s.funding_amount || 0,
    }));

  // Top patterns with companies
  const patterns = Object.entries(stats.genai_analysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topPatterns = patterns.map(([name, count]) => {
    const companies = startups
      .filter(s => s.build_patterns?.some(p => p.name === name))
      .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
      .slice(0, 3)
      .map(s => s.company_name);
    return { name, count, companies };
  });

  // Geographic distribution
  const totalFunding = stats.deal_summary.total_funding_usd;
  const geographicDistribution = Object.entries(stats.funding_by_continent)
    .sort((a, b) => b[1].total_usd - a[1].total_usd)
    .slice(0, 5)
    .map(([region, bucket]) => ({
      region,
      amount: bucket.total_usd,
      percentage: Math.round((bucket.total_usd / totalFunding) * 100),
    }));

  return {
    period,
    insight: generateInsight(stats),
    context: generateContext(stats),
    stats: {
      totalFunding: stats.deal_summary.total_funding_usd,
      totalDeals: stats.deal_summary.total_deals,
      genaiAdoptionRate: Math.round(stats.genai_analysis.genai_adoption_rate * 100),
    },
    topDeals,
    topPatterns,
    geographicDistribution,
  };
}

async function main() {
  console.log('Generating briefing JSON files...');

  // Ensure output directories exist
  await fs.mkdir(OUTPUT_PATH, { recursive: true });
  await fs.mkdir(BRIEFS_PATH, { recursive: true });

  // Get all available periods
  const periods = await getAvailablePeriods();
  console.log(`Found ${periods.length} periods:`, periods);

  // Import the new brief generator
  const { generateMonthlyBrief } = await import('../lib/data/generate-monthly-brief');

  // Generate briefing for each period
  for (const period of periods) {
    try {
      if (!FORCE_REGEN && await isPeriodUpToDate(period)) {
        console.log(`  ↺ Skipped ${period} (already up to date)`);
        continue;
      }

      if (GENERATE_LEGACY) {
        const briefing = await generateBriefing(period);
        const outputFile = path.join(OUTPUT_PATH, `${period}.json`);
        await fs.writeFile(outputFile, JSON.stringify(briefing, null, 2));
        console.log(`  ✓ Generated briefings/${period}.json (legacy)`);
      }

      // Generate new Intelligence Brief format
      const brief = await generateMonthlyBrief(period);
      const briefFile = path.join(BRIEFS_PATH, `${period}.json`);
      await fs.writeFile(briefFile, JSON.stringify(brief, null, 2));
      console.log(`  ✓ Generated briefs/${period}.json (new)`);

      // Also save to data directory for server-side use
      const dataOutputPath = path.join(DATA_PATH, period, 'output', 'monthly_brief.json');
      await fs.writeFile(dataOutputPath, JSON.stringify(brief, null, 2));
      console.log(`  ✓ Generated data/${period}/output/monthly_brief.json`);
    } catch (error) {
      console.error(`  ✗ Failed to generate ${period}:`, error);
    }
  }

  console.log('Done!');
}

main().catch(console.error);

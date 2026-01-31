import { promises as fs } from 'fs';
import path from 'path';
import type {
  MonthlyStats,
  NewsletterData,
  StartupAnalysis,
  PeriodInfo,
} from '@startup-intelligence/shared';

// Base data path - configurable via environment variable
// For static export, use the data directory relative to the web app
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data');

/**
 * Get all available periods
 */
export async function getAvailablePeriods(): Promise<PeriodInfo[]> {
  try {
    const dataDir = path.join(DATA_PATH);
    const entries = await fs.readdir(dataDir, { withFileTypes: true });

    const periods: PeriodInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)) {
        const statsPath = path.join(dataDir, entry.name, 'output', 'monthly_stats.json');
        try {
          const stats = await getMonthlyStats(entry.name);
          periods.push({
            period: entry.name,
            deal_count: stats.deal_summary.total_deals,
            total_funding: stats.deal_summary.total_funding_usd,
            has_newsletter: true,
          });
        } catch {
          // Period exists but no stats yet
          periods.push({
            period: entry.name,
            deal_count: 0,
            total_funding: 0,
            has_newsletter: false,
          });
        }
      }
    }

    // Sort by period descending (most recent first)
    return periods.sort((a, b) => b.period.localeCompare(a.period));
  } catch (error) {
    console.error('Error reading periods:', error);
    return [];
  }
}

/**
 * Get monthly statistics for a period
 */
export async function getMonthlyStats(period: string): Promise<MonthlyStats> {
  const filePath = path.join(DATA_PATH, period, 'output', 'monthly_stats.json');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as MonthlyStats;
}

/**
 * Get newsletter data for a period
 */
export async function getNewsletterData(period: string): Promise<NewsletterData> {
  const filePath = path.join(DATA_PATH, period, 'output', 'newsletter_data.json');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as NewsletterData;
}

/**
 * Get all startup analyses for a period
 * Uses parallel file reads for performance (275 files in ~400ms vs 2-3s sequential)
 */
export async function getStartups(period: string): Promise<StartupAnalysis[]> {
  const storePath = path.join(DATA_PATH, period, 'output', 'analysis_store');
  const indexPath = path.join(storePath, 'index.json');

  try {
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(indexContent);

    // Load all startup files in parallel for performance
    const loadPromises = Object.entries(index.startups || {}).map(
      async ([name, info]): Promise<StartupAnalysis | null> => {
        const startupInfo = info as { slug: string; has_base: boolean; has_viral: boolean };

        if (!startupInfo.has_base) return null;

        try {
          const basePath = path.join(storePath, 'base_analyses', `${startupInfo.slug}.json`);
          const baseContent = await fs.readFile(basePath, 'utf-8');
          let startup = JSON.parse(baseContent);

          // If viral analysis exists, merge it
          if (startupInfo.has_viral) {
            try {
              const viralPath = path.join(storePath, 'viral_analyses', `${startupInfo.slug}.json`);
              const viralContent = await fs.readFile(viralPath, 'utf-8');
              const viralAnalysis = JSON.parse(viralContent);
              startup = { ...startup, ...viralAnalysis };
            } catch {
              // Viral analysis optional, continue with base
            }
          }

          return startup;
        } catch (err) {
          console.error(`Error loading startup ${name}:`, err);
          return null;
        }
      }
    );

    const results = await Promise.all(loadPromises);
    const startups = results.filter((s): s is StartupAnalysis => s !== null);

    // Sort by funding amount descending
    return startups.sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));
  } catch (error) {
    console.error('Error reading startups:', error);
    return [];
  }
}

/**
 * Get a single startup by slug
 */
export async function getStartup(
  period: string,
  slug: string
): Promise<StartupAnalysis | null> {
  const storePath = path.join(DATA_PATH, period, 'output', 'analysis_store');

  try {
    const basePath = path.join(storePath, 'base_analyses', `${slug}.json`);
    const baseContent = await fs.readFile(basePath, 'utf-8');
    const baseAnalysis = JSON.parse(baseContent);

    // Try to get viral analysis too
    try {
      const viralPath = path.join(storePath, 'viral_analyses', `${slug}.json`);
      const viralContent = await fs.readFile(viralPath, 'utf-8');
      const viralAnalysis = JSON.parse(viralContent);
      return { ...baseAnalysis, ...viralAnalysis };
    } catch {
      return baseAnalysis;
    }
  } catch {
    return null;
  }
}

/**
 * Get the comprehensive newsletter markdown
 */
export async function getNewsletterMarkdown(period: string): Promise<string | null> {
  const filePath = path.join(
    DATA_PATH,
    period,
    'output',
    'comprehensive_newsletter.md'
  );

  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    // Fall back to viral newsletter
    try {
      const viralPath = path.join(DATA_PATH, period, 'output', 'viral_newsletter.md');
      return await fs.readFile(viralPath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/**
 * Get startup crawl metadata (URLs crawled)
 */
export interface StartupCrawlMetadata {
  company_name: string;
  slug: string;
  pages_crawled: number;
  urls: string[];
  sources_by_type: {
    website?: string[];
    blog?: string[];
    docs?: string[];
    github?: string[];
    news?: string[];
  };
  crawled_at: string;
}

export async function getStartupMetadata(
  period: string,
  slug: string
): Promise<StartupCrawlMetadata | null> {
  const metadataPath = path.join(
    DATA_PATH,
    period,
    'output',
    'raw_content',
    slug,
    'metadata.json'
  );

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as StartupCrawlMetadata;
  } catch {
    return null;
  }
}

/**
 * Vertical statistics for visualization
 */
export interface VerticalStats {
  vertical: string;
  displayName: string;
  startupCount: number;
  totalFunding: number;
  avgFunding: number;
  genaiCount: number;
  genaiAdoptionRate: number;
  isHorizontal: boolean;
  topStartups: Array<{ name: string; funding: number }>;
}

/**
 * Compute vertical-level statistics from startup analyses
 */
export async function getVerticalStats(period: string): Promise<VerticalStats[]> {
  const startups = await getStartups(period);

  // Group by vertical
  const verticalMap = new Map<string, {
    startups: StartupAnalysis[];
    totalFunding: number;
    genaiCount: number;
  }>();

  for (const startup of startups) {
    const vertical = startup.vertical || 'other';
    const isHorizontal = startup.market_type === 'horizontal';

    // Use market_type to differentiate horizontal platforms
    const key = isHorizontal ? 'horizontal' : vertical;

    if (!verticalMap.has(key)) {
      verticalMap.set(key, { startups: [], totalFunding: 0, genaiCount: 0 });
    }

    const data = verticalMap.get(key)!;
    data.startups.push(startup);
    data.totalFunding += startup.funding_amount || 0;
    if (startup.uses_genai) {
      data.genaiCount++;
    }
  }

  // Convert to array with computed stats
  const stats: VerticalStats[] = [];

  for (const [vertical, data] of verticalMap.entries()) {
    const displayName = formatVerticalName(vertical);
    const topStartups = data.startups
      .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
      .slice(0, 3)
      .map(s => ({ name: s.company_name, funding: s.funding_amount || 0 }));

    stats.push({
      vertical,
      displayName,
      startupCount: data.startups.length,
      totalFunding: data.totalFunding,
      avgFunding: data.totalFunding / data.startups.length,
      genaiCount: data.genaiCount,
      genaiAdoptionRate: data.genaiCount / data.startups.length,
      isHorizontal: vertical === 'horizontal',
      topStartups,
    });
  }

  // Sort by startup count descending
  return stats.sort((a, b) => b.startupCount - a.startupCount);
}

/**
 * Format vertical enum to display name
 */
function formatVerticalName(vertical: string): string {
  const names: Record<string, string> = {
    horizontal: 'AI & Machine Learning',
    healthcare: 'Healthcare (HealthTech)',
    developer_tools: 'Developer Tools & Platforms',
    enterprise_saas: 'Productivity & Collaboration',
    marketing: 'Sales, Marketing & CX',
    financial_services: 'Fintech',
    legal: 'LegalTech',
    cybersecurity: 'Cybersecurity',
    industrial: 'Supply Chain & Logistics',
    education: 'Education',
    consumer: 'Consumer',
    ecommerce: 'E-commerce',
    hr_recruiting: 'HR & Recruiting',
    media_content: 'Media & Content',
    other: 'Other',
  };
  return names[vertical] || vertical.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Get top deals for visualization
 */
export interface TopDeal {
  name: string;
  slug: string;
  funding: number;
  stage: string;
  vertical: string;
  location?: string;
  usesGenai: boolean;
}

export async function getTopDeals(period: string, limit: number = 20): Promise<TopDeal[]> {
  const startups = await getStartups(period);

  return startups
    .filter(s => s.funding_amount && s.funding_amount > 0)
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
    .slice(0, limit)
    .map(s => ({
      name: s.company_name,
      slug: s.company_slug,
      funding: s.funding_amount || 0,
      stage: s.funding_stage || 'unknown',
      vertical: formatVerticalName(s.market_type === 'horizontal' ? 'horizontal' : (s.vertical || 'other')),
      location: undefined, // Could add from CSV data if needed
      usesGenai: s.uses_genai,
    }));
}

/**
 * Get startup brief markdown
 */
export async function getStartupBrief(
  period: string,
  slug: string
): Promise<string | null> {
  const briefPath = path.join(
    DATA_PATH,
    period,
    'output',
    'briefs',
    `${slug}_brief.md`
  );

  try {
    return await fs.readFile(briefPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Investment by Vertical with Stage Breakdown
 */
export interface VerticalInvestment {
  vertical: string;
  displayName: string;
  totalFunding: number;
  startupCount: number;
  byStage: {
    seed: number;
    early_stage: number; // Series A, B
    late_stage: number;  // Series C, D+
    other: number;       // Unknown, debt, etc.
  };
  topStartups: Array<{ name: string; funding: number; slug: string }>;
}

export async function getInvestmentByVertical(period: string): Promise<VerticalInvestment[]> {
  const startups = await getStartups(period);

  const verticalMap = new Map<string, {
    data: Omit<VerticalInvestment, 'topStartups'>;
    startups: StartupAnalysis[];
  }>();

  for (const startup of startups) {
    // Determine vertical key
    const isHorizontal = startup.market_type === 'horizontal';
    const vertical = isHorizontal ? 'horizontal' : (startup.vertical || 'other');

    if (!verticalMap.has(vertical)) {
      verticalMap.set(vertical, {
        data: {
          vertical,
          displayName: formatVerticalName(vertical),
          totalFunding: 0,
          startupCount: 0,
          byStage: { seed: 0, early_stage: 0, late_stage: 0, other: 0 },
        },
        startups: [],
      });
    }

    const entry = verticalMap.get(vertical)!;
    const funding = startup.funding_amount || 0;
    entry.data.totalFunding += funding;
    entry.data.startupCount++;
    entry.startups.push(startup);

    // Categorize by stage
    const stage = startup.funding_stage || 'unknown';
    if (stage === 'seed' || stage === 'pre_seed') {
      entry.data.byStage.seed += funding;
    } else if (stage === 'series_a' || stage === 'series_b') {
      entry.data.byStage.early_stage += funding;
    } else if (stage === 'series_c' || stage === 'series_d_plus' || stage === 'late_stage') {
      entry.data.byStage.late_stage += funding;
    } else {
      entry.data.byStage.other += funding;
    }
  }

  return Array.from(verticalMap.values())
    .map(({ data, startups: s }) => ({
      ...data,
      topStartups: s
        .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
        .slice(0, 5)
        .map(startup => ({
          name: startup.company_name,
          funding: startup.funding_amount || 0,
          slug: startup.company_slug,
        })),
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding);
}

/**
 * AI/ML Sub-vertical categories
 */
export interface AISubVertical {
  category: string;
  displayName: string;
  totalFunding: number;
  startupCount: number;
  byStage: {
    seed: number;
    early_stage: number;
    late_stage: number;
    other: number;
  };
  topStartups: Array<{ name: string; funding: number; slug: string }>;
}

/**
 * Classify AI startups into sub-verticals based on patterns and descriptions
 */
function classifyAISubVertical(startup: StartupAnalysis): string {
  const patterns = startup.build_patterns?.map(p => p.name.toLowerCase()) || [];
  const description = (startup.description || '').toLowerCase();
  const subVertical = (startup.sub_vertical || '').toLowerCase();

  // Check for Foundation Models / LLMs
  if (
    patterns.some(p => p.includes('foundation') || p.includes('llm')) ||
    description.includes('foundation model') ||
    description.includes('large language model') ||
    subVertical.includes('foundation') ||
    startup.tech_stack?.has_custom_models
  ) {
    return 'foundation_models';
  }

  // Check for Agentic AI / Orchestration
  if (
    patterns.some(p => p.includes('agentic') || p.includes('agent')) ||
    description.includes('agentic') ||
    description.includes('autonomous agent')
  ) {
    return 'agentic_orchestration';
  }

  // Check for RAG / Vector DBs / LLMOps
  if (
    patterns.some(p => p.includes('rag') || p.includes('retrieval')) ||
    description.includes('retrieval') ||
    description.includes('vector database') ||
    description.includes('llmops')
  ) {
    return 'rag_vector_llmops';
  }

  // Check for MLOps
  if (
    description.includes('mlops') ||
    description.includes('ml platform') ||
    description.includes('model deployment') ||
    description.includes('model serving')
  ) {
    return 'mlops';
  }

  // Check for Multimodal
  if (
    description.includes('multimodal') ||
    description.includes('vision') ||
    description.includes('image generation') ||
    description.includes('video')
  ) {
    return 'multimodal';
  }

  // Check for AI Safety / Evals
  if (
    patterns.some(p => p.includes('guardrail')) ||
    description.includes('safety') ||
    description.includes('evaluation') ||
    description.includes('red team')
  ) {
    return 'ai_safety_evals';
  }

  // Check for AutoML / Low-code AI
  if (
    description.includes('automl') ||
    description.includes('no-code') ||
    description.includes('low-code')
  ) {
    return 'automl_lowcode';
  }

  // Check for Synthetic Data / Labeling
  if (
    description.includes('synthetic data') ||
    description.includes('data labeling') ||
    description.includes('annotation')
  ) {
    return 'synthetic_data_labeling';
  }

  // Check for Edge AI
  if (
    description.includes('edge') ||
    description.includes('on-device') ||
    description.includes('embedded')
  ) {
    return 'edge_ai';
  }

  return 'other_ai';
}

const AI_SUBVERTICAL_NAMES: Record<string, string> = {
  foundation_models: 'Foundation Models/LLMs',
  mlops: 'MLOps',
  agentic_orchestration: 'Agentic AI/Orchestration',
  rag_vector_llmops: 'RAG/Vector DBs/LLMOps',
  multimodal: 'Multimodal',
  ai_safety_evals: 'AI Safety/Evals',
  automl_lowcode: 'AutoML/Low-code AI',
  synthetic_data_labeling: 'Synthetic Data/Labeling',
  edge_ai: 'Edge AI',
  other_ai: 'Other AI',
};

export async function getAISubVerticalStats(period: string): Promise<AISubVertical[]> {
  const startups = await getStartups(period);

  // Filter to AI/ML horizontal startups
  const aiStartups = startups.filter(
    s => s.market_type === 'horizontal' || s.uses_genai
  );

  const subVerticalMap = new Map<string, {
    funding: number;
    count: number;
    byStage: { seed: number; early_stage: number; late_stage: number; other: number };
    startups: StartupAnalysis[];
  }>();

  for (const startup of aiStartups) {
    const category = classifyAISubVertical(startup);
    const funding = startup.funding_amount || 0;

    if (!subVerticalMap.has(category)) {
      subVerticalMap.set(category, {
        funding: 0,
        count: 0,
        byStage: { seed: 0, early_stage: 0, late_stage: 0, other: 0 },
        startups: [],
      });
    }

    const data = subVerticalMap.get(category)!;
    data.funding += funding;
    data.count++;
    data.startups.push(startup);

    const stage = startup.funding_stage || 'unknown';
    if (stage === 'seed' || stage === 'pre_seed') {
      data.byStage.seed += funding;
    } else if (stage === 'series_a' || stage === 'series_b') {
      data.byStage.early_stage += funding;
    } else if (stage === 'series_c' || stage === 'series_d_plus' || stage === 'late_stage') {
      data.byStage.late_stage += funding;
    } else {
      data.byStage.other += funding;
    }
  }

  return Array.from(subVerticalMap.entries())
    .map(([category, data]) => ({
      category,
      displayName: AI_SUBVERTICAL_NAMES[category] || category,
      totalFunding: data.funding,
      startupCount: data.count,
      byStage: data.byStage,
      topStartups: data.startups
        .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
        .slice(0, 3)
        .map(s => ({ name: s.company_name, funding: s.funding_amount || 0, slug: s.company_slug })),
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding);
}

/**
 * Model Usage Statistics
 */
export interface ModelUsage {
  model: string;
  provider: string;
  displayName: string;
  totalFunding: number;
  startupCount: number;
  byStage: {
    seed: number;
    early_stage: number;
    late_stage: number;
  };
  startups: Array<{
    name: string;
    slug: string;
    funding: number;
    usage: string; // How they use the model
  }>;
}

/**
 * Normalize model names to provider groups
 */
function normalizeModelProvider(model: string): { provider: string; displayName: string } | null {
  const modelLower = model.toLowerCase();

  if (modelLower.includes('gpt') || modelLower.includes('openai') || modelLower.includes('chatgpt')) {
    return { provider: 'openai', displayName: 'OpenAI/GPT' };
  }
  if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
    return { provider: 'anthropic', displayName: 'Anthropic/Claude' };
  }
  if (modelLower.includes('llama') || modelLower.includes('meta')) {
    return { provider: 'meta', displayName: 'Meta/Llama' };
  }
  if (modelLower.includes('gemini') || modelLower.includes('palm') || modelLower.includes('google')) {
    return { provider: 'google', displayName: 'Google/Gemini' };
  }
  if (modelLower.includes('cohere')) {
    return { provider: 'cohere', displayName: 'Cohere' };
  }
  if (modelLower.includes('qwen') || modelLower.includes('alibaba')) {
    return { provider: 'alibaba', displayName: 'Alibaba/Qwen' };
  }
  if (modelLower.includes('grok') || modelLower.includes('xai')) {
    return { provider: 'xai', displayName: 'xAI/Grok' };
  }
  if (modelLower.includes('mistral')) {
    return { provider: 'mistral', displayName: 'Mistral' };
  }

  return null;
}

export async function getModelUsageStats(period: string): Promise<ModelUsage[]> {
  const startups = await getStartups(period);

  const modelMap = new Map<string, {
    displayName: string;
    funding: number;
    count: number;
    byStage: { seed: number; early_stage: number; late_stage: number };
    startups: Array<{ name: string; slug: string; funding: number; models: string[] }>;
  }>();

  for (const startup of startups) {
    // Collect all models mentioned
    const allModels = [
      ...(startup.models_mentioned || []),
      ...(startup.tech_stack?.llm_models || []),
      ...(startup.tech_stack?.llm_providers || []),
    ];

    const seenProviders = new Set<string>();

    for (const model of allModels) {
      const normalized = normalizeModelProvider(model);
      if (!normalized || seenProviders.has(normalized.provider)) continue;
      seenProviders.add(normalized.provider);

      if (!modelMap.has(normalized.provider)) {
        modelMap.set(normalized.provider, {
          displayName: normalized.displayName,
          funding: 0,
          count: 0,
          byStage: { seed: 0, early_stage: 0, late_stage: 0 },
          startups: [],
        });
      }

      const data = modelMap.get(normalized.provider)!;
      const funding = startup.funding_amount || 0;
      data.funding += funding;
      data.count++;
      data.startups.push({
        name: startup.company_name,
        slug: startup.company_slug,
        funding,
        models: allModels.filter(m => {
          const n = normalizeModelProvider(m);
          return n && n.provider === normalized.provider;
        }),
      });

      const stage = startup.funding_stage || 'unknown';
      if (stage === 'seed' || stage === 'pre_seed') {
        data.byStage.seed += funding;
      } else if (stage === 'series_a' || stage === 'series_b') {
        data.byStage.early_stage += funding;
      } else {
        data.byStage.late_stage += funding;
      }
    }
  }

  return Array.from(modelMap.entries())
    .map(([provider, data]) => ({
      model: provider,
      provider,
      displayName: data.displayName,
      totalFunding: data.funding,
      startupCount: data.count,
      byStage: data.byStage,
      startups: data.startups
        .sort((a, b) => b.funding - a.funding)
        .slice(0, 10)
        .map(s => ({
          name: s.name,
          slug: s.slug,
          funding: s.funding,
          usage: s.models.join(', '),
        })),
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding);
}

/**
 * Pattern Statistics with Top Startups
 */
export interface PatternStats {
  name: string;
  count: number;
  percentage: number;
  topStartups: Array<{ name: string; funding: number; slug: string }>;
}

export async function getPatternStats(period: string): Promise<PatternStats[]> {
  const startups = await getStartups(period);
  const stats = await getMonthlyStats(period);
  const totalAnalyzed = stats.genai_analysis.total_analyzed;

  const patternMap = new Map<string, {
    count: number;
    startups: StartupAnalysis[];
  }>();

  for (const startup of startups) {
    for (const pattern of startup.build_patterns || []) {
      const name = pattern.name;
      if (!patternMap.has(name)) {
        patternMap.set(name, { count: 0, startups: [] });
      }
      const data = patternMap.get(name)!;
      data.count++;
      data.startups.push(startup);
    }
  }

  return Array.from(patternMap.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      percentage: (data.count / totalAnalyzed) * 100,
      topStartups: data.startups
        .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0))
        .slice(0, 5)
        .map(s => ({
          name: s.company_name,
          funding: s.funding_amount || 0,
          slug: s.company_slug,
        })),
    }))
    .sort((a, b) => b.count - a.count);
}

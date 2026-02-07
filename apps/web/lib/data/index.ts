import { promises as fs } from 'fs';
import path from 'path';
import type {
  MonthlyStats,
  NewsletterData,
  StartupAnalysis,
  PeriodInfo,
} from '@startup-intelligence/shared';
import { api, isAPIConfigured, type DealbookFilters, type DealbookResponse } from '@/lib/api/client';
import { normalizeStageKey } from '@/lib/utils';
import { normalizeDatasetRegion } from '@/lib/region';

// Base data path - configurable via environment variable
// For static export, use the data directory relative to the web app
const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data');

/**
 * Resolve data path for a region. Global data lives at DATA_PATH root,
 * regional data lives under DATA_PATH/{region}/
 */
function getDataPath(region?: string): string {
  const r = normalizeDatasetRegion(region);
  // Turkey data is stored under DATA_PATH/tr on disk for historical reasons.
  const folder = r === 'turkey' ? 'tr' : null;
  return folder ? path.join(DATA_PATH, folder) : DATA_PATH;
}

/** Build a cache key that includes the region prefix */
function cacheKey(region: string | undefined, period: string): string {
  return `${normalizeDatasetRegion(region)}:${period}`;
}

// In-memory cache for startups data (avoids re-reading 275 files on each page)
const startupsCache = new Map<string, {
  data: StartupAnalysis[];
  timestamp: number;
}>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory cache for periods (keyed by region)
const periodsCache = new Map<string, { data: PeriodInfo[]; timestamp: number }>();
const PERIODS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// In-memory cache for monthly stats
const statsCache = new Map<string, { data: MonthlyStats; timestamp: number }>();
const STATS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get all available periods (with caching)
 */
export async function getAvailablePeriods(region?: string): Promise<PeriodInfo[]> {
  const regionKey = normalizeDatasetRegion(region);

  // Check cache first
  const cached = periodsCache.get(regionKey);
  if (cached && Date.now() - cached.timestamp < PERIODS_CACHE_TTL) {
    return cached.data;
  }

  // For global data, prefer API-backed periods so "latest" matches what the Dealbook API can serve.
  // (Files can be ahead of DB, which makes global look empty if we pick a month the API lacks.)
  if (regionKey === 'global' && isAPIConfigured()) {
    try {
      const periods = await api.getPeriods();
      periodsCache.set(regionKey, { data: periods, timestamp: Date.now() });
      return periods;
    } catch (error) {
      console.error('API request failed for getAvailablePeriods, falling back to file-based periods:', error);
    }
  }

  try {
    const dataDir = getDataPath(region);
    const entries = await fs.readdir(dataDir, { withFileTypes: true });

    // Filter to only period directories
    const periodDirs = entries.filter(
      entry => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name)
    );

    // Load stats for all periods in parallel for better performance
    const periodsWithStats = await Promise.all(
      periodDirs.map(async (entry): Promise<PeriodInfo> => {
        try {
          const stats = await getMonthlyStatsInternal(entry.name, region);
          return {
            period: entry.name,
            deal_count: stats.deal_summary.total_deals,
            total_funding: stats.deal_summary.total_funding_usd,
            has_newsletter: true,
          };
        } catch {
          return {
            period: entry.name,
            deal_count: 0,
            total_funding: 0,
            has_newsletter: false,
          };
        }
      })
    );

    // Sort by period descending (most recent first)
    const sorted = periodsWithStats.sort((a, b) => b.period.localeCompare(a.period));

    // Cache the result
    periodsCache.set(regionKey, { data: sorted, timestamp: Date.now() });

    return sorted;
  } catch (error) {
    console.error('Error reading periods:', error);
    return [];
  }
}

/**
 * Internal function to get stats without the 'all' handling (to avoid circular calls)
 */
async function getMonthlyStatsInternal(period: string, region?: string): Promise<MonthlyStats> {
  // Check cache first
  const key = cacheKey(region, period);
  const cached = statsCache.get(key);
  if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
    return cached.data;
  }

  const filePath = path.join(getDataPath(region), period, 'output', 'monthly_stats.json');
  const content = await fs.readFile(filePath, 'utf-8');
  const stats = JSON.parse(content) as MonthlyStats;

  // Cache the result
  statsCache.set(key, { data: stats, timestamp: Date.now() });

  return stats;
}

/**
 * Get monthly statistics for a period (with caching)
 * Supports 'all' to aggregate stats across all periods
 */
export async function getMonthlyStats(period: string, region?: string): Promise<MonthlyStats> {
  // Handle 'all' period - aggregate stats across all periods
  if (period === 'all') {
    return getAggregatedStats(region);
  }

  return getMonthlyStatsInternal(period, region);
}

// Cache for aggregated stats (keyed by region)
const aggregatedStatsCache = new Map<string, { data: MonthlyStats; timestamp: number }>();

/**
 * Aggregate stats across all available periods (with caching)
 */
async function getAggregatedStats(region?: string): Promise<MonthlyStats> {
  const regionKey = normalizeDatasetRegion(region);

  // Check cache first (5 minute TTL like startups)
  const cached = aggregatedStatsCache.get(regionKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const periods = await getAvailablePeriods(region);

  // Load stats from all periods using cached function
  const allStats = await Promise.all(
    periods.map(async p => {
      try {
        return await getMonthlyStatsInternal(p.period, region);
      } catch {
        return null;
      }
    })
  );

  const validStats = allStats.filter((s): s is MonthlyStats => s !== null);

  if (validStats.length === 0) {
    throw new Error('No stats available');
  }

  // Aggregate deal summary
  const totalDeals = validStats.reduce((sum, s) => sum + s.deal_summary.total_deals, 0);
  const totalFunding = validStats.reduce((sum, s) => sum + s.deal_summary.total_funding_usd, 0);

  // Use the latest period's stats as the base and override aggregated values
  const latestStats = validStats[0];

  const aggregated: MonthlyStats = {
    ...latestStats,
    period: 'all',
    deal_summary: {
      ...latestStats.deal_summary,
      total_deals: totalDeals,
      total_funding_usd: totalFunding,
      average_deal_size: totalDeals > 0 ? totalFunding / totalDeals : 0,
    },
    genai_analysis: {
      ...latestStats.genai_analysis,
      total_analyzed: validStats.reduce((sum, s) => sum + s.genai_analysis.total_analyzed, 0),
      uses_genai_count: validStats.reduce((sum, s) => sum + s.genai_analysis.uses_genai_count, 0),
      genai_adoption_rate: validStats.length > 0
        ? validStats.reduce((sum, s) => sum + s.genai_analysis.uses_genai_count, 0) /
          validStats.reduce((sum, s) => sum + s.genai_analysis.total_analyzed, 0)
        : 0,
    },
  };

  // Cache the result
  aggregatedStatsCache.set(regionKey, { data: aggregated, timestamp: Date.now() });

  return aggregated;
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
 * Load startups from all available periods, deduplicated by slug
 * Uses the most recent version of each startup
 */
async function getAllStartupsAcrossPeriods(region?: string): Promise<StartupAnalysis[]> {
  // Check cache first
  const key = cacheKey(region, 'all');
  const cached = startupsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const periods = await getAvailablePeriods(region);

  // Load startups from all periods in parallel
  const allStartupsArrays = await Promise.all(
    periods.map(p => getStartupsForPeriod(p.period, region))
  );

  // Deduplicate by slug, keeping the most recent (first occurrence wins since periods are sorted desc)
  const slugMap = new Map<string, StartupAnalysis>();
  for (const startups of allStartupsArrays) {
    for (const startup of startups) {
      if (!slugMap.has(startup.company_slug)) {
        slugMap.set(startup.company_slug, startup);
      }
    }
  }

  const allStartups = Array.from(slugMap.values())
    .sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));

  // Cache the result
  startupsCache.set(key, {
    data: allStartups,
    timestamp: Date.now(),
  });

  return allStartups;
}

/**
 * Internal function to get startups for a specific period (no 'all' handling)
 */
async function getStartupsForPeriod(period: string, region?: string): Promise<StartupAnalysis[]> {
  // Check cache first
  const key = cacheKey(region, period);
  const cached = startupsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const storePath = path.join(getDataPath(region), period, 'output', 'analysis_store');
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
    const sorted = startups.sort((a, b) => (b.funding_amount || 0) - (a.funding_amount || 0));

    // Cache the result
    startupsCache.set(key, {
      data: sorted,
      timestamp: Date.now(),
    });

    return sorted;
  } catch (error) {
    console.error('Error reading startups:', error);
    return [];
  }
}

/**
 * Get all startup analyses for a period
 * Uses in-memory caching + parallel file reads for performance
 * Supports 'all' to load startups from all periods
 *
 * NOTE: Tries API first for faster performance when API is configured
 */
export async function getStartups(period: string, region?: string): Promise<StartupAnalysis[]> {
  // Handle 'all' period - load from all available periods
  if (period === 'all') {
    return getAllStartupsAcrossPeriods(region);
  }

  // Regional data is always file-based (API only has global data)
  const isRegional = normalizeDatasetRegion(region) !== 'global';

  // Try API first if configured (much faster than loading 275+ files)
  if (!isRegional && isAPIConfigured()) {
    try {
      // Check cache first to avoid API call if we have recent data
      const cached = startupsCache.get(cacheKey(region, period));
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }

      // Use dealbook endpoint with high limit to get all startups
      // Note: API caps limit at 100 per page, so we paginate to get all
      const allStartups: DealbookResponse['data'] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const response = await api.getDealbook({
          period,
          page,
          limit: 100,
          sortBy: 'funding',
          sortOrder: 'desc',
        });
        allStartups.push(...response.data);
        hasMore = response.pagination.page < response.pagination.totalPages;
        page++;
      }

      const response = { data: allStartups };

      // Convert API response to StartupAnalysis format
      // Using type assertion since API returns compatible data but with string types
      const startups = response.data.map(s => ({
        company_name: s.company_name,
        company_slug: s.company_slug,
        description: s.description || undefined,
        website: s.website || undefined,
        location: s.location || undefined,
        vertical: s.vertical || undefined,
        market_type: s.market_type || undefined,
        sub_vertical: s.sub_vertical || undefined,
        sub_sub_vertical: s.sub_sub_vertical || undefined,
        vertical_taxonomy: s.vertical_taxonomy || undefined,
        funding_amount: s.funding_amount || undefined,
        funding_stage: s.funding_stage || undefined,
        uses_genai: s.uses_genai,
        build_patterns: s.build_patterns || [],
        confidence_score: s.confidence_score || undefined,
        newsletter_potential: s.newsletter_potential || undefined,
        tech_stack: s.tech_stack || undefined,
        models_mentioned: s.models_mentioned || [],
      })) as StartupAnalysis[];

      // Cache the result
      startupsCache.set(cacheKey(region, period), {
        data: startups,
        timestamp: Date.now(),
      });

      return startups;
    } catch (error) {
      console.error('API request failed for getStartups, falling back to file-based data:', error);
    }
  }

  // Delegate to internal function for specific periods (file-based fallback)
  return getStartupsForPeriod(period, region);
}

/**
 * Paginated response type for database-driven queries
 */
export interface PaginatedStartupsResponse {
  data: StartupAnalysis[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: DealbookFilters;
}

/**
 * Get startups with database-driven pagination and filtering
 * Falls back to file-based filtering when API is not available
 */
export async function getStartupsPaginated(
  period: string,
  options: DealbookFilters & { region?: string } = {}
): Promise<PaginatedStartupsResponse> {
  const { region, ...apiOptions } = options;
  const isRegional = region && region !== 'global';

  // Try API first if configured (API only has global data)
  if (!isRegional && isAPIConfigured()) {
    try {
      const response = await api.getDealbook({
        period,
        ...apiOptions,
      });

      return {
        data: response.data as unknown as StartupAnalysis[],
        pagination: response.pagination,
        filters: apiOptions,
      };
    } catch (error) {
      console.error('API request failed, falling back to file-based data:', error);
    }
  }

  // Fallback to file-based data with client-side filtering
  const allStartups = await getStartups(period, region);
  let filtered = [...allStartups];

  // Apply filters
  if (options.stage) {
    const selectedStage = normalizeStageKey(options.stage);
    filtered = filtered.filter(s => normalizeStageKey(s.funding_stage).startsWith(selectedStage));
  }
  if (options.pattern) {
    filtered = filtered.filter(s =>
      s.build_patterns?.some(p => p.name === options.pattern)
    );
  }
  if (options.continent) {
    filtered = filtered.filter(s => {
      const location = s.location || '';
      return location.toLowerCase().includes(options.continent!.toLowerCase());
    });
  }
  if (options.vertical) {
    const selectedVertical = normalizeStageKey(options.vertical);
    filtered = filtered.filter(s => normalizeStageKey(s.vertical) === selectedVertical);
  }
  if (options.verticalId) {
    const vId = options.verticalId;
    filtered = filtered.filter(s => (s.vertical_taxonomy?.primary?.vertical_id || '') === vId);
  }
  if (options.subVerticalId) {
    const svId = options.subVerticalId;
    filtered = filtered.filter(s => (s.vertical_taxonomy?.primary?.sub_vertical_id || '') === svId);
  }
  if (options.leafId) {
    const leafId = options.leafId;
    filtered = filtered.filter(s => (s.vertical_taxonomy?.primary?.leaf_id || '') === leafId);
  }
  if (options.minFunding !== undefined) {
    filtered = filtered.filter(s => (s.funding_amount || 0) >= options.minFunding!);
  }
  if (options.maxFunding !== undefined) {
    filtered = filtered.filter(s => (s.funding_amount || 0) <= options.maxFunding!);
  }
  if (options.usesGenai !== undefined) {
    filtered = filtered.filter(s => s.uses_genai === options.usesGenai);
  }
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter(s =>
      s.company_name.toLowerCase().includes(searchLower) ||
      (s.description || '').toLowerCase().includes(searchLower) ||
      (s.vertical || '').toLowerCase().includes(searchLower) ||
      (s.sub_vertical || '').toLowerCase().includes(searchLower) ||
      (s.sub_sub_vertical || '').toLowerCase().includes(searchLower)
    );
  }

  // Apply sorting
  const sortBy = options.sortBy || 'funding';
  const sortOrder = options.sortOrder || 'desc';
  filtered.sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'funding') {
      comparison = (a.funding_amount || 0) - (b.funding_amount || 0);
    } else if (sortBy === 'name') {
      comparison = a.company_name.localeCompare(b.company_name);
    } else if (sortBy === 'date') {
      // Sort by analyzed_at (when deal was added/analyzed)
      const dateA = a.analyzed_at ? new Date(a.analyzed_at).getTime() : 0;
      const dateB = b.analyzed_at ? new Date(b.analyzed_at).getTime() : 0;
      comparison = dateA - dateB;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Apply pagination
  const page = options.page || 1;
  const limit = options.limit || 25;
  const total = filtered.length;
  const startIndex = (page - 1) * limit;
  const paginatedData = filtered.slice(startIndex, startIndex + limit);

  return {
    data: paginatedData,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    filters: options,
  };
}

/**
 * Get available filter options for a period
 */
export async function getFilterOptions(
  period: string,
  region?: string,
  opts?: { verticalId?: string; subVerticalId?: string }
): Promise<{
  stages: string[];
  continents: string[];
  patterns: Array<{ name: string; count: number }>;
  verticals: string[];
  vertical_taxonomy?: {
    verticals: Array<{ id: string; label: string; count: number }>;
    sub_verticals?: Array<{ id: string; label: string; count: number }>;
    leaves?: Array<{ id: string; label: string; count: number }>;
  };
}> {
  // Optional cascading taxonomy selection (only affects which sub/leaf options we return).
  const taxonomyVerticalId = opts?.verticalId;
  const taxonomySubVerticalId = opts?.subVerticalId;
  const isRegional = region && region !== 'global';

  // Try API first if configured (API only has global data)
  if (!isRegional && isAPIConfigured()) {
    try {
      return await api.getDealbookFilters(period, { verticalId: taxonomyVerticalId, subVerticalId: taxonomySubVerticalId });
    } catch (error) {
      console.error('API request failed, falling back to file-based data:', error);
    }
  }

  // Fallback to computing from file data
  const startups = await getStartups(period, region);

  const stageSet = new Set<string>();
  const continentSet = new Set<string>();
  const patternMap = new Map<string, number>();
  const verticalSet = new Set<string>();
  const taxonomyVerticalMap = new Map<string, { id: string; label: string; count: number }>();
  const taxonomySubMap = new Map<string, { id: string; label: string; count: number }>();
  const taxonomyLeafMap = new Map<string, { id: string; label: string; count: number }>();

  for (const startup of startups) {
    if (startup.funding_stage) stageSet.add(startup.funding_stage);

    // Extract continent from location if available
    const location = startup.location || '';
    const parts = location.split(', ');
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart && ['North America', 'Europe', 'Asia', 'South America', 'Africa', 'Oceania'].includes(lastPart)) {
        continentSet.add(lastPart);
      }
    }

    for (const pattern of startup.build_patterns || []) {
      patternMap.set(pattern.name, (patternMap.get(pattern.name) || 0) + 1);
    }

    if (startup.vertical) verticalSet.add(startup.vertical);

    const primary = startup.vertical_taxonomy?.primary;
    const vId = primary?.vertical_id || undefined;
    const vLabel = primary?.vertical_label || undefined;
    const svId = primary?.sub_vertical_id || undefined;
    const svLabel = primary?.sub_vertical_label || undefined;
    const leafId = primary?.leaf_id || undefined;
    const leafLabel = primary?.leaf_label || undefined;

    if (vId && vLabel) {
      const curr = taxonomyVerticalMap.get(vId) || { id: vId, label: vLabel, count: 0 };
      curr.count += 1;
      taxonomyVerticalMap.set(vId, curr);
    }

    if (taxonomyVerticalId && vId === taxonomyVerticalId && svId && svLabel) {
      const curr = taxonomySubMap.get(svId) || { id: svId, label: svLabel, count: 0 };
      curr.count += 1;
      taxonomySubMap.set(svId, curr);
    }

    if (taxonomySubVerticalId && svId === taxonomySubVerticalId && leafId && leafLabel) {
      const curr = taxonomyLeafMap.get(leafId) || { id: leafId, label: leafLabel, count: 0 };
      curr.count += 1;
      taxonomyLeafMap.set(leafId, curr);
    }
  }

  return {
    stages: Array.from(stageSet).sort(),
    continents: Array.from(continentSet).sort(),
    patterns: Array.from(patternMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    verticals: Array.from(verticalSet).sort(),
    vertical_taxonomy: {
      verticals: Array.from(taxonomyVerticalMap.values()).sort((a, b) => b.count - a.count),
      sub_verticals: Array.from(taxonomySubMap.values()).sort((a, b) => b.count - a.count),
      leaves: Array.from(taxonomyLeafMap.values()).sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * Get a single startup by slug
 */
export async function getStartup(
  period: string,
  slug: string,
  region?: string
): Promise<StartupAnalysis | null> {
  const isRegional = region && region !== 'global';

  // Prefer API when configured (API only has global data).
  if (!isRegional && isAPIConfigured()) {
    try {
      const response = await api.getCompanyBySlug(slug, period);
      if (response && (response as any).data) {
        return (response as any).data as StartupAnalysis;
      }
    } catch (error) {
      console.error('API request failed for getStartup, falling back to file-based data:', error);
    }
  }

  const storePath = path.join(getDataPath(region), period, 'output', 'analysis_store');

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
export async function getNewsletterMarkdown(period: string, region?: string): Promise<string | null> {
  const dataPath = getDataPath(region);
  const filePath = path.join(
    dataPath,
    period,
    'output',
    'comprehensive_newsletter.md'
  );

  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    // Fall back to viral newsletter
    try {
      const viralPath = path.join(dataPath, period, 'output', 'viral_newsletter.md');
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
  slug: string,
  region?: string
): Promise<StartupCrawlMetadata | null> {
  const metadataPath = path.join(
    getDataPath(region),
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
  slug: string,
  region?: string
): Promise<string | null> {
  const briefPath = path.join(
    getDataPath(region),
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

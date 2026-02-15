/**
 * API Client for Backend Service
 * Used when NEXT_PUBLIC_API_URL is configured
 *
 * IMPORTANT: API calls should only be made from Server Components or API routes
 * to keep the API key secure.
 */

import 'server-only';

import type { PeriodInfo } from '@startup-intelligence/shared';

const DEFAULT_PROD_API_URL = 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net';
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_API_URL : 'http://localhost:3001');

// Server-side only API key (not exposed to client)
const API_KEY = process.env.API_KEY;

interface FetchOptions extends RequestInit {
  timeout?: number;
}

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Fetch wrapper with error handling and timeout
 */
export async function fetchFromAPI<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (process.env.NODE_ENV === 'production' && !API_KEY) {
      // In prod the backend requires X-API-Key, so fail fast with a clear message.
      throw new APIError('Server misconfigured: API_KEY is not set', 500, 'Misconfigured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...fetchOptions.headers as Record<string, string>,
    };

    // Include API key if available (server-side only)
    if (API_KEY) {
      headers['X-API-Key'] = API_KEY;
    }

    // Do not let Next.js cache API responses by default. The backend already has its own caching
    // (Redis + CDN headers), and Next-level caching can cause confusing staleness after deploys.
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      cache: fetchOptions.cache ?? 'no-store',
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      // Prefer backend-provided `{ error: string }` message when available.
      let backendMessage: string | null = null;
      try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await response.json().catch(() => null);
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            const msg = (body as any).error;
            if (typeof msg === 'string' && msg.trim()) backendMessage = msg.trim();
          }
        }
      } catch {
        // Ignore parse errors; fall back to status text.
      }
      throw new APIError(
        backendMessage || `API request failed: ${response.statusText}`,
        response.status,
        response.statusText
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new APIError('Request timeout', 408, 'Request Timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Response types
export interface StartupResponse {
  data: Startup[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Startup {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  headquartersCity: string | null;
  headquartersCountry: string | null;
  continent: string | null;
  industry: string | null;
  pattern: string | null;
  stage: string | null;
  genaiNative: boolean;
  moneyRaisedUsd: number | null;
  announcedDate: string | null;
  subVertical: string | null;
  briefContent: string | null;
  period: string | null;
}

export interface StatsResponse {
  totalFunding: number;
  totalDeals: number;
  totalStartups: number;
  genaiNativeCount: number;
  genaiAdoptionRate: string;
  patternDistribution: Record<string, number>;
  stageDistribution: Record<string, number>;
}

export interface InvestorsResponse {
  data: Investor[];
}

export interface Investor {
  id: string;
  name: string;
  type: string | null;
  website: string | null;
  headquartersCountry: string | null;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  database: string;
}

export interface DealbookFilters {
  period?: string;
  region?: string;
  page?: number;
  limit?: number;
  stage?: string;
  pattern?: string;
  continent?: string;
  vertical?: string;
  verticalId?: string;
  subVerticalId?: string;
  leafId?: string;
  minFunding?: number;
  maxFunding?: number;
  usesGenai?: boolean;
  sortBy?: 'funding' | 'name' | 'date';
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface DealbookStartup {
  company_name: string;
  company_slug: string;
  description: string | null;
  website: string | null;
  location: string | null;
  continent: string | null;
  vertical: string | null;
  market_type: string | null;
  sub_vertical: string | null;
  sub_sub_vertical: string | null;
  vertical_taxonomy?: Record<string, unknown> | null;
  funding_amount: number | null;
  funding_stage: string | null;
  uses_genai: boolean;
  build_patterns: Array<{ name: string; confidence: number; evidence: string[] }> | null;
  confidence_score: number | null;
  newsletter_potential: string | null;
  tech_stack: Record<string, unknown> | null;
  models_mentioned: string[] | null;
}

export interface DealbookResponse {
  data: DealbookStartup[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    period: string;
    region?: string | null;
    stage: string | null;
    pattern: string | null;
    continent: string | null;
    vertical: string | null;
    verticalId?: string | null;
    subVerticalId?: string | null;
    leafId?: string | null;
    minFunding: number | null;
    maxFunding: number | null;
    usesGenai: string | null;
    search: string | null;
  };
}

export interface DealbookFiltersResponse {
  stages: string[];
  continents: string[];
  patterns: Array<{ name: string; count: number }>;
  verticals: string[];
  vertical_taxonomy?: {
    verticals: Array<{ id: string; label: string; count: number }>;
    sub_verticals?: Array<{ id: string; label: string; count: number }>;
    leaves?: Array<{ id: string; label: string; count: number }>;
  };
}

export interface CompanyBySlugResponse {
  data: unknown;
}

/**
 * API methods
 */
export const api = {
  /**
   * Get available periods ordered newest -> oldest.
   */
  getPeriods: (region?: string): Promise<PeriodInfo[]> => {
    const searchParams = new URLSearchParams();
    if (region && region !== 'global') searchParams.set('region', region);
    const query = searchParams.toString();
    return fetchFromAPI(`/api/v1/periods${query ? `?${query}` : ''}`);
  },

  /**
   * Health check
   */
  health: (): Promise<HealthResponse> => fetchFromAPI('/health'),

  /**
   * Get platform statistics
   */
  getStats: (params?: { period?: string; region?: string }): Promise<StatsResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.set('period', params.period);
    if (params?.region && params.region !== 'global') searchParams.set('region', params.region);
    const query = searchParams.toString();
    return fetchFromAPI(`/api/v1/stats${query ? `?${query}` : ''}`);
  },

  /**
   * Get list of startups with pagination
   */
  getStartups: (params?: {
    page?: number;
    limit?: number;
    region?: string;
  }): Promise<StartupResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.region && params.region !== 'global') searchParams.set('region', params.region);
    const query = searchParams.toString();
    return fetchFromAPI(`/api/v1/startups${query ? `?${query}` : ''}`);
  },

  /**
   * Get single startup by ID
   */
  getStartup: (id: string): Promise<Startup> =>
    fetchFromAPI(`/api/v1/startups/${id}`),

  /**
   * Get list of investors
   */
  getInvestors: (): Promise<InvestorsResponse> =>
    fetchFromAPI('/api/v1/investors'),

  /**
   * Get dealbook data with filtering and pagination
   */
  getDealbook: (filters: DealbookFilters = {}): Promise<DealbookResponse> => {
    const searchParams = new URLSearchParams();
    if (filters.period) searchParams.set('period', filters.period);
    if (filters.region && filters.region !== 'global') searchParams.set('region', filters.region);
    if (filters.page) searchParams.set('page', filters.page.toString());
    if (filters.limit) searchParams.set('limit', filters.limit.toString());
    if (filters.stage) searchParams.set('stage', filters.stage);
    if (filters.pattern) searchParams.set('pattern', filters.pattern);
    if (filters.continent) searchParams.set('continent', filters.continent);
    if (filters.vertical) searchParams.set('vertical', filters.vertical);
    if (filters.verticalId) searchParams.set('verticalId', filters.verticalId);
    if (filters.subVerticalId) searchParams.set('subVerticalId', filters.subVerticalId);
    if (filters.leafId) searchParams.set('leafId', filters.leafId);
    if (filters.minFunding !== undefined) searchParams.set('minFunding', filters.minFunding.toString());
    if (filters.maxFunding !== undefined) searchParams.set('maxFunding', filters.maxFunding.toString());
    if (filters.usesGenai !== undefined) searchParams.set('usesGenai', filters.usesGenai.toString());
    if (filters.sortBy) searchParams.set('sortBy', filters.sortBy);
    if (filters.sortOrder) searchParams.set('sortOrder', filters.sortOrder);
    if (filters.search) searchParams.set('search', filters.search);
    const query = searchParams.toString();
    return fetchFromAPI(`/api/v1/dealbook${query ? `?${query}` : ''}`);
  },

  /**
   * Get available filter options for dealbook
   */
  getDealbookFilters: (period = 'all', opts?: { region?: string; verticalId?: string; subVerticalId?: string }): Promise<DealbookFiltersResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.set('period', period);
    if (opts?.region && opts.region !== 'global') searchParams.set('region', opts.region);
    if (opts?.verticalId) searchParams.set('verticalId', opts.verticalId);
    if (opts?.subVerticalId) searchParams.set('subVerticalId', opts.subVerticalId);
    return fetchFromAPI(`/api/v1/dealbook/filters?${searchParams.toString()}`);
  },

  /**
   * Get company profile by slug (analysis data when available).
   */
  getCompanyBySlug: (slug: string, period: string = 'all', region?: string): Promise<CompanyBySlugResponse> => {
    const searchParams = new URLSearchParams();
    if (period && period !== 'all') searchParams.set('period', period);
    if (region && region !== 'global') searchParams.set('region', region);
    const query = searchParams.toString();
    return fetchFromAPI(`/api/v1/companies/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`);
  },
};

/**
 * Check if API is available
 */
export function isAPIConfigured(): boolean {
  // In production we always have a safe default API base URL (Front Door),
  // so treat the backend as "configured" even if NEXT_PUBLIC_API_URL isn't set.
  // In dev, we only opt into API calls when an explicit URL is provided.
  return process.env.NODE_ENV === 'production' ? true : !!process.env.NEXT_PUBLIC_API_URL;
}

// =============================================================================
// SIGNAL INTELLIGENCE
// =============================================================================

export interface StageAdoption {
  adopters: number;
  total: number;
  pct: number;
}

export interface StageContext {
  adoption_by_stage: Record<string, StageAdoption>;
  stage_acceleration: string | null;
  computed_at: string;
}

export interface SignalExplain {
  definition: string;
  why: string;
  examples: string[];
  risk: string;
  time_horizon: string;
  top_evidence: Array<{
    snippet: string;
    source: string;
    date: string;
    url?: string;
  }>;
}

export interface SignalItem {
  id: string;
  domain: string;
  cluster_name: string | null;
  claim: string;
  region: string;
  conviction: number;
  momentum: number;
  impact: number;
  adoption_velocity: number;
  status: 'candidate' | 'emerging' | 'accelerating' | 'established' | 'decaying';
  evidence_count: number;
  unique_company_count: number;
  first_seen_at: string;
  last_evidence_at: string | null;
  stage_context?: StageContext;
  explain?: SignalExplain;
  explain_generated_at?: string;
  evidence_timeline?: number[];
  evidence_timeline_meta?: {
    bin_count: number;
    timeline_start: string;
    timeline_end: string;
  };
}

export interface SignalsSummaryResponse {
  rising: SignalItem[];
  established: SignalItem[];
  decaying: SignalItem[];
  stats: {
    total: number;
    by_status: Record<string, number>;
    by_domain: Record<string, number>;
  };
}

export interface SignalsListResponse {
  signals: SignalItem[];
  total: number;
}

export async function getSignalsSummary(region?: string): Promise<SignalsSummaryResponse> {
  const params = new URLSearchParams();
  if (region) params.set('region', region);
  return fetchFromAPI<SignalsSummaryResponse>(`/api/v1/signals/summary?${params.toString()}`);
}

export async function getSignalsList(params?: {
  region?: string;
  status?: string;
  domain?: string;
  sector?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<SignalsListResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.status) qs.set('status', params.status);
  if (params?.domain) qs.set('domain', params.domain);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return fetchFromAPI<SignalsListResponse>(`/api/v1/signals?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Signal Deep Dives
// ---------------------------------------------------------------------------

export interface DeepDiveContent {
  tldr: string;
  mechanism: string;
  patterns: Array<{ archetype: string; description: string; startups: string[] }>;
  case_studies: Array<{
    startup_slug: string;
    startup_name: string;
    summary: string;
    key_moves: string[];
  }>;
  thresholds: Array<{ metric: string; value: string; action: string }>;
  failure_modes: Array<{ mode: string; description: string; example: string | null }>;
  watchlist: Array<{ startup_slug: string; why: string }>;
}

export interface DeepDiveResponse {
  deep_dive: {
    id: string;
    signal_id: string;
    version: number;
    status: string;
    content_json: DeepDiveContent;
    sample_startup_ids: string[];
    sample_count: number;
    generation_model: string | null;
    generation_cost_tokens: number | null;
    evidence_hash: string | null;
    created_at: string;
  } | null;
  signal: SignalItem | null;
  diff: {
    from_version: number;
    to_version: number;
    diff_json: Record<string, any>;
    created_at: string;
  } | null;
  meta?: {
    schema_missing: boolean;
    unlinked_evidence_count: number;
    startups_with_evidence: number;
    startups_eligible: number;
    occurrences_total: number;
    latest_status: string | null;
    latest_version: number | null;
    latest_created_at: string | null;
  } | null;
}

export interface OccurrenceItem {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  funding_stage: string | null;
  score: number;
  features_json: Record<string, any>;
  explain_json: Record<string, any>;
  evidence_count: number;
  computed_at: string;
}

export interface MoveItem {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  move_type: string;
  what_happened: string;
  why_it_worked: string | null;
  unique_angle: string | null;
  timestamp_hint: string | null;
  evidence_ids: string[];
  confidence: number;
  extracted_at: string;
}

export interface DeepDiveListItem {
  signal_id: string;
  claim: string;
  domain: string;
  status: string;
  conviction: number;
  momentum: number;
  region: string;
  version: number;
  created_at: string;
  tldr: string;
  sample_count: number;
}

export async function getDeepDive(signalId: string): Promise<DeepDiveResponse> {
  return fetchFromAPI<DeepDiveResponse>(`/api/v1/signals/${signalId}/deep-dive`);
}

export async function getOccurrences(signalId: string, limit = 50, offset = 0): Promise<{
  occurrences: OccurrenceItem[];
  total: number;
}> {
  return fetchFromAPI(`/api/v1/signals/${signalId}/occurrences?limit=${limit}&offset=${offset}`);
}

export async function getMoves(signalId: string, startupId?: string): Promise<MoveItem[]> {
  const qs = startupId ? `?startup_id=${startupId}` : '';
  return fetchFromAPI<MoveItem[]>(`/api/v1/signals/${signalId}/moves${qs}`);
}

// ---------------------------------------------------------------------------
// Movers / Changefeed
// ---------------------------------------------------------------------------

export interface DeltaEvent {
  id: string;
  startup_id: string | null;
  startup_name: string | null;
  startup_slug: string | null;
  signal_id: string | null;
  delta_type: string;
  domain: string;
  region: string;
  old_value: string | null;
  new_value: string | null;
  magnitude: number | null;
  direction: string | null;
  headline: string;
  detail: string | null;
  evidence_json: Record<string, any>;
  period: string | null;
  effective_at: string;
}

export interface MoversSummaryResponse {
  top_movers: DeltaEvent[];
  by_type: Record<string, number>;
  total: number;
}

export interface DeltaFeedResponse {
  events: DeltaEvent[];
  total: number;
}

export async function getMoversSummary(params?: {
  region?: string;
  sector?: string;
  period?: string;
  limit?: number;
}): Promise<MoversSummaryResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.period) qs.set('period', params.period);
  if (params?.limit) qs.set('limit', String(params.limit));
  return fetchFromAPI<MoversSummaryResponse>(`/api/v1/movers/summary?${qs.toString()}`);
}

export async function getDeltaFeed(params?: {
  region?: string;
  delta_type?: string;
  domain?: string;
  sector?: string;
  period?: string;
  min_magnitude?: number;
  limit?: number;
  offset?: number;
}): Promise<DeltaFeedResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.delta_type) qs.set('delta_type', params.delta_type);
  if (params?.domain) qs.set('domain', params.domain);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.period) qs.set('period', params.period);
  if (params?.min_magnitude != null) qs.set('min_magnitude', String(params.min_magnitude));
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return fetchFromAPI<DeltaFeedResponse>(`/api/v1/movers?${qs.toString()}`);
}

export async function getStartupDeltas(slug: string, region?: string, limit?: number): Promise<{
  events: DeltaEvent[];
}> {
  const qs = new URLSearchParams();
  if (region) qs.set('region', region);
  if (limit) qs.set('limit', String(limit));
  return fetchFromAPI(`/api/v1/companies/${slug}/deltas?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Comparables & Benchmarks
// ---------------------------------------------------------------------------

export interface NeighborItem {
  id: string;
  name: string;
  slug: string;
  vertical: string | null;
  stage: string | null;
  rank: number;
  overall_score: number;
  vector_score: number | null;
  pattern_score: number | null;
  meta_score: number | null;
  shared_patterns: string[];
  period: string | null;
}

export interface NeighborsResponse {
  neighbors: NeighborItem[];
  method: string;
}

export interface BenchmarkItem {
  cohort_key: string;
  cohort_type: string;
  metric: string;
  cohort_size: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  stddev: number | null;
  period: string;
}

export interface BenchmarksResponse {
  startup_values: Record<string, number | null>;
  benchmarks: BenchmarkItem[];
  cohort_keys: string[];
}

export async function getStartupNeighbors(slug: string, params?: {
  region?: string;
  period?: string;
  limit?: number;
}): Promise<NeighborsResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.period) qs.set('period', params.period);
  if (params?.limit) qs.set('limit', String(params.limit));
  return fetchFromAPI<NeighborsResponse>(`/api/v1/companies/${slug}/neighbors?${qs.toString()}`);
}

export async function getStartupBenchmarks(slug: string, params?: {
  region?: string;
  period?: string;
}): Promise<BenchmarksResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.period) qs.set('period', params.period);
  return fetchFromAPI<BenchmarksResponse>(`/api/v1/companies/${slug}/benchmarks?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Benchmarks (standalone page)
// ---------------------------------------------------------------------------

export interface CohortBenchmark {
  cohort_key: string;
  cohort_type: string;
  metric: string;
  cohort_size: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  stddev: number | null;
  period: string;
}

export interface CohortInfo {
  cohort_key: string;
  cohort_type: string;
  size: number;
  metrics: string[];
}

export interface BenchmarksListResponse {
  benchmarks: CohortBenchmark[];
  total: number;
}

export async function getBenchmarksList(params?: {
  cohort_type?: string;
  cohort_key?: string;
  sector?: string;
  region?: string;
  period?: string;
  metric?: string;
}): Promise<BenchmarksListResponse> {
  const qs = new URLSearchParams();
  if (params?.cohort_type) qs.set('cohort_type', params.cohort_type);
  if (params?.cohort_key) qs.set('cohort_key', params.cohort_key);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.region) qs.set('region', params.region);
  if (params?.period) qs.set('period', params.period);
  if (params?.metric) qs.set('metric', params.metric);
  return fetchFromAPI<BenchmarksListResponse>(`/api/v1/benchmarks?${qs.toString()}`);
}

export async function getBenchmarksCohorts(region?: string): Promise<CohortInfo[]> {
  const qs = new URLSearchParams();
  if (region) qs.set('region', region);
  return fetchFromAPI<CohortInfo[]>(`/api/v1/benchmarks/cohorts?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Investor DNA
// ---------------------------------------------------------------------------

export interface InvestorDNA {
  investor_id: string;
  investor_name: string;
  investor_type: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  median_check_usd: number | null;
  pattern_deal_counts: Record<string, number>;
  pattern_amounts: Record<string, number>;
  stage_deal_counts: Record<string, number>;
  stage_amounts: Record<string, number>;
  thesis_shift_js: number | null;
  top_gainers: Array<{ pattern: string; delta_pp: number }> | null;
  top_partners: Array<{ investor_id: string; name: string; co_deals: number }>;
}

export interface InvestorScreenerItem {
  investor_id: string;
  name: string;
  type: string | null;
  country: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  top_patterns: string[];
  thesis_shift_js: number | null;
  news_count: number;
  last_news_at?: string | null;
}

export interface InvestorScreenerResponse {
  investors: InvestorScreenerItem[];
  total: number;
}

export async function getInvestorDNA(investorId: string, scope?: string): Promise<InvestorDNA> {
  const qs = new URLSearchParams();
  if (scope) qs.set('scope', scope);
  return fetchFromAPI<InvestorDNA>(`/api/v1/investors/${investorId}/dna?${qs.toString()}`);
}

export async function getInvestorScreener(params?: {
  pattern?: string;
  stage?: string;
  sort?: string;
  scope?: string;
  limit?: number;
  offset?: number;
}): Promise<InvestorScreenerResponse> {
  const qs = new URLSearchParams();
  if (params?.pattern) qs.set('pattern', params.pattern);
  if (params?.stage) qs.set('stage', params.stage);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.scope) qs.set('scope', params.scope);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return fetchFromAPI<InvestorScreenerResponse>(`/api/v1/investors/screener?${qs.toString()}`);
}

export async function getInvestorPortfolio(investorId: string, scope?: string): Promise<{
  portfolio: Array<{
    startup_id: string;
    name: string;
    slug: string;
    stage: string | null;
    patterns: string[];
    amount_usd: number | null;
    round_type: string;
  }>;
  total: number;
}> {
  const qs = new URLSearchParams();
  if (scope) qs.set('scope', scope);
  return fetchFromAPI(`/api/v1/investors/${investorId}/portfolio?${qs.toString()}`);
}

// ---------------------------------------------------------------------------
// Pattern Landscapes
// ---------------------------------------------------------------------------

export interface TreemapNode {
  name: string;
  value: number;
  count: number;
  funding: number;
  children?: TreemapNode[];
  startups?: Array<{ id: string; name: string; slug: string; funding: number }>;
}

export interface ClusterDetail {
  pattern: string;
  startup_count: number;
  total_funding: number;
  deal_count: number;
  top_startups: Array<{ id: string; name: string; slug: string; funding: number; stage: string | null }>;
  top_investors: Array<{ name: string; deal_count: number }>;
  related_patterns: string[];
  signal_summary: Record<string, number>;
}

export async function getLandscapes(params?: {
  scope?: string;
  period?: string;
  sector?: string;
  size_by?: string;
  stage?: string;
}): Promise<TreemapNode[]> {
  const qs = new URLSearchParams();
  if (params?.scope) qs.set('scope', params.scope);
  if (params?.period) qs.set('period', params.period);
  if (params?.sector) qs.set('sector', params.sector);
  if (params?.size_by) qs.set('size_by', params.size_by);
  if (params?.stage) qs.set('stage', params.stage);
  return fetchFromAPI<TreemapNode[]>(`/api/v1/landscapes?${qs.toString()}`);
}

export async function getLandscapeCluster(pattern: string, scope?: string): Promise<ClusterDetail> {
  const qs = new URLSearchParams({ pattern });
  if (scope) qs.set('scope', scope);
  return fetchFromAPI<ClusterDetail>(`/api/v1/landscapes/cluster?${qs.toString()}`);
}

// Re-export health utilities
export {
  checkApiHealth,
  checkInfrastructureHealth,
  wakeUpBackend,
  ensureBackendAvailable,
  waitForBackend,
} from './health';

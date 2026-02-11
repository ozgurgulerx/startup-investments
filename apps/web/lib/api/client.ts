/**
 * API Client for Backend Service
 * Used when NEXT_PUBLIC_API_URL is configured
 *
 * IMPORTANT: API calls should only be made from Server Components or API routes
 * to keep the API key secure.
 */

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
      throw new APIError(
        `API request failed: ${response.statusText}`,
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
    if (filters.minFunding) searchParams.set('minFunding', filters.minFunding.toString());
    if (filters.maxFunding) searchParams.set('maxFunding', filters.maxFunding.toString());
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
  sort?: string;
  limit?: number;
  offset?: number;
}): Promise<SignalsListResponse> {
  const qs = new URLSearchParams();
  if (params?.region) qs.set('region', params.region);
  if (params?.status) qs.set('status', params.status);
  if (params?.domain) qs.set('domain', params.domain);
  if (params?.sort) qs.set('sort', params.sort);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return fetchFromAPI<SignalsListResponse>(`/api/v1/signals?${qs.toString()}`);
}

// Re-export health utilities
export {
  checkApiHealth,
  checkInfrastructureHealth,
  wakeUpBackend,
  ensureBackendAvailable,
  waitForBackend,
} from './health';

/**
 * API Client for Backend Service
 * Used when NEXT_PUBLIC_API_URL is configured
 *
 * IMPORTANT: API calls should only be made from Server Components or API routes
 * to keep the API key secure.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...fetchOptions.headers as Record<string, string>,
    };

    // Include API key if available (server-side only)
    if (API_KEY) {
      headers['X-API-Key'] = API_KEY;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
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

/**
 * API methods
 */
export const api = {
  /**
   * Health check
   */
  health: (): Promise<HealthResponse> => fetchFromAPI('/health'),

  /**
   * Get platform statistics
   */
  getStats: (): Promise<StatsResponse> => fetchFromAPI('/api/v1/stats'),

  /**
   * Get list of startups with pagination
   */
  getStartups: (params?: {
    page?: number;
    limit?: number;
  }): Promise<StartupResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
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
};

/**
 * Check if API is available
 */
export function isAPIConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_API_URL;
}

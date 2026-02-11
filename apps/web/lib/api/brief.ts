/**
 * Frontend API client for Brief Editions
 *
 * Server-side: uses fetchFromAPI (includes X-API-Key header)
 */

import { fetchFromAPI } from './client';
import type { BriefSnapshot, BriefEditionSummary } from '@startup-intelligence/shared';

export type { BriefSnapshot, BriefEditionSummary };

/**
 * Fetch a brief snapshot from the API (server-side).
 * Supports lookup by edition_id or by coordinates (region, periodType, periodStart, kind).
 */
export async function getBriefSnapshot(params: {
  editionId?: string;
  region?: string;
  periodType?: string;
  periodStart?: string;
  kind?: string;
  revision?: number;
}): Promise<BriefSnapshot | null> {
  try {
    const qs = new URLSearchParams();
    if (params.editionId) qs.set('edition_id', params.editionId);
    if (params.region && params.region !== 'global') qs.set('region', params.region);
    if (params.periodType && params.periodType !== 'monthly') qs.set('period_type', params.periodType);
    if (params.periodStart) qs.set('period_start', params.periodStart);
    if (params.kind) qs.set('kind', params.kind);
    if (params.revision) qs.set('revision', String(params.revision));
    const query = qs.toString();

    return await fetchFromAPI<BriefSnapshot>(
      `/api/v1/brief${query ? `?${query}` : ''}`
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && (error as any).status === 404) {
      return null;
    }
    console.error('Failed to fetch brief snapshot:', error);
    return null;
  }
}

/**
 * List brief editions from the API (server-side).
 */
export async function listBriefEditions(params: {
  region?: string;
  periodType?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: BriefEditionSummary[]; total: number }> {
  try {
    const qs = new URLSearchParams();
    if (params.region && params.region !== 'global') qs.set('region', params.region);
    if (params.periodType && params.periodType !== 'monthly') qs.set('period_type', params.periodType);
    if (params.kind) qs.set('kind', params.kind);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));

    return await fetchFromAPI<{ items: BriefEditionSummary[]; total: number }>(
      `/api/v1/briefs/list?${qs.toString()}`
    );
  } catch {
    return { items: [], total: 0 };
  }
}

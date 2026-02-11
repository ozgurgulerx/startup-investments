/**
 * Frontend API client for Brief Snapshots
 *
 * Server-side: uses fetchFromAPI (includes X-API-Key header)
 * Client-side: uses relative fetch (via Next.js proxy or direct)
 */

import { fetchFromAPI } from './client';
import type { BriefSnapshot, BriefSnapshotSummary } from '@startup-intelligence/shared';

export type { BriefSnapshot, BriefSnapshotSummary };

/**
 * Fetch the latest brief snapshot from the API (server-side)
 */
export async function getBriefSnapshot(
  region: string = 'global',
  periodType: string = 'monthly',
  periodKey?: string,
): Promise<BriefSnapshot | null> {
  try {
    const params = new URLSearchParams();
    if (region && region !== 'global') params.set('region', region);
    if (periodType !== 'monthly') params.set('period_type', periodType);
    if (periodKey) params.set('period_key', periodKey);
    const query = params.toString();

    const snapshot = await fetchFromAPI<BriefSnapshot>(
      `/api/v1/brief${query ? `?${query}` : ''}`
    );
    return snapshot;
  } catch (error) {
    // 404 = no snapshot yet, fall back gracefully
    if (error && typeof error === 'object' && 'status' in error && (error as any).status === 404) {
      return null;
    }
    console.error('Failed to fetch brief snapshot:', error);
    return null;
  }
}

/**
 * Fetch brief archive listing (server-side)
 */
export async function getBriefArchive(
  region: string = 'global',
  periodType: string = 'monthly',
  limit: number = 20,
  offset: number = 0,
): Promise<{ items: BriefSnapshotSummary[]; total: number }> {
  try {
    const params = new URLSearchParams();
    if (region && region !== 'global') params.set('region', region);
    if (periodType !== 'monthly') params.set('period_type', periodType);
    params.set('limit', limit.toString());
    params.set('offset', offset.toString());

    return await fetchFromAPI<{ items: BriefSnapshotSummary[]; total: number }>(
      `/api/v1/brief/archive?${params.toString()}`
    );
  } catch {
    return { items: [], total: 0 };
  }
}

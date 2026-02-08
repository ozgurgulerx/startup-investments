import 'server-only';

import type { NewsArchiveDay, NewsEdition, NewsSourceRef, NewsTopicStat, PeriodicBrief, PeriodicBriefSummary } from '@startup-intelligence/shared';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export type NewsRegion = 'global' | 'turkey';

function normalizeNewsRegion(input?: string | null): NewsRegion {
  const raw = (input || '').toLowerCase().trim();
  if (raw === 'turkey' || raw === 'tr') return 'turkey';
  return 'global';
}

async function fetchOptionalFromAPI<T>(endpoint: string): Promise<T | null> {
  try {
    return await fetchFromAPI<T>(endpoint);
  } catch (error) {
    if (error instanceof APIError && error.status === 404) return null;
    throw error;
  }
}

async function fetchListFromAPI<T>(endpoint: string): Promise<T[]> {
  try {
    return await fetchFromAPI<T[]>(endpoint);
  } catch (error) {
    if (error instanceof APIError && error.status === 404) return [];
    throw error;
  }
}

export async function getLatestNewsEditionDate(region: NewsRegion = 'global'): Promise<string | null> {
  const normalized = normalizeNewsRegion(region);
  const data = await fetchOptionalFromAPI<{ edition_date: string | null }>(
    `/api/v1/news/latest-date?region=${normalized}`
  );
  return data?.edition_date || null;
}

export async function getNewsEdition(params?: {
  date?: string;
  topic?: string;
  limit?: number;
  region?: NewsRegion;
}): Promise<NewsEdition | null> {
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.date) qs.set('date', params.date);
  if (params?.topic) qs.set('topic', params.topic);
  if (params?.limit != null) qs.set('limit', String(params.limit));

  return fetchOptionalFromAPI<NewsEdition>(`/api/v1/news?${qs.toString()}`);
}

export async function getNewsTopics(params?: {
  date?: string;
  limit?: number;
  region?: NewsRegion;
}): Promise<NewsTopicStat[]> {
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.date) qs.set('date', params.date);
  if (params?.limit != null) qs.set('limit', String(params.limit));

  return fetchListFromAPI<NewsTopicStat>(`/api/v1/news/topics?${qs.toString()}`);
}

export async function getNewsArchive(params?: {
  limit?: number;
  offset?: number;
  region?: NewsRegion;
}): Promise<NewsArchiveDay[]> {
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));

  return fetchListFromAPI<NewsArchiveDay>(`/api/v1/news/archive?${qs.toString()}`);
}

export async function getActiveNewsSources(params?: { region?: NewsRegion }): Promise<NewsSourceRef[]> {
  const region = normalizeNewsRegion(params?.region);
  return fetchListFromAPI<NewsSourceRef>(`/api/v1/news/sources?region=${region}`);
}

export async function getPeriodicBrief(params: {
  periodType: 'weekly' | 'monthly';
  region?: NewsRegion;
  date?: string;
}): Promise<PeriodicBrief | null> {
  const region = normalizeNewsRegion(params.region);
  const datePart = params.date ? `/${params.date}` : '';
  return fetchOptionalFromAPI<PeriodicBrief>(
    `/api/v1/news/briefs/${params.periodType}${datePart}?region=${region}`
  );
}

export async function getPeriodicBriefArchive(params: {
  periodType: 'weekly' | 'monthly';
  region?: NewsRegion;
  limit?: number;
  offset?: number;
}): Promise<PeriodicBriefSummary[]> {
  const region = normalizeNewsRegion(params.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  qs.set('type', params.periodType);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  return fetchListFromAPI<PeriodicBriefSummary>(`/api/v1/news/briefs/archive?${qs.toString()}`);
}

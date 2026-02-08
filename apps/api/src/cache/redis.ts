/**
 * Redis Cache Layer
 *
 * Provides caching for API responses to reduce database load.
 * Gracefully degrades if Redis is unavailable.
 */

import { createClient, RedisClientType } from 'redis';
import crypto from 'crypto';

let client: RedisClientType | null = null;
let lastAttemptTime = 0;
let consecutiveFailures = 0;

const BASE_BACKOFF_MS = 30_000;       // 30 seconds
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes cap

function getBackoffMs(): number {
  if (consecutiveFailures === 0) return 0;
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS);
}

/**
 * Get Redis client (lazy initialization with exponential backoff)
 * Returns null if REDIS_URL not configured or within backoff window after failure
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (client?.isReady) {
    return client;
  }

  // Check if we're still in the backoff window
  const now = Date.now();
  if (lastAttemptTime > 0 && now - lastAttemptTime < getBackoffMs()) {
    return null;
  }

  lastAttemptTime = now;

  try {
    // Disconnect stale client to avoid socket leaks
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
      client = null;
    }

    client = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.error('Redis: Max reconnection attempts reached');
            return new Error('Max reconnection attempts');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    client.on('error', (err) => {
      console.error('Redis error:', err.message);
    });

    client.on('connect', () => {
      console.log('Redis: Connected');
    });

    client.on('ready', () => {
      console.log('Redis: Ready');
      consecutiveFailures = 0;
    });

    await client.connect();
    consecutiveFailures = 0;
    return client;
  } catch (error) {
    consecutiveFailures++;
    const nextRetryMs = getBackoffMs();
    console.error(
      `Redis: Connection failed (failure #${consecutiveFailures}, next retry in ${Math.round(nextRetryMs / 1000)}s):`,
      error instanceof Error ? error.message : error
    );
    client = null;
    return null;
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedisClient(): Promise<void> {
  if (client?.isReady) {
    await client.quit();
  }
  client = null;
  lastAttemptTime = 0;
  consecutiveFailures = 0;
}

// ============================================================================
// Cache Key Helpers
// ============================================================================

/**
 * Generate cache key for dealbook queries
 */
export function dealBookKey(region: string, period: string, page: number, filtersHash: string): string {
  const safeRegion = (region || 'global').toLowerCase().trim() || 'global';
  return `dealbook:v1:${safeRegion}:${period}:p${page}:${filtersHash}`;
}

/**
 * Generate cache key for company profile queries (by slug + period).
 */
export function companyBySlugKey(region: string, period: string, slug: string): string {
  const safeRegion = (region || 'global').toLowerCase().trim() || 'global';
  const safePeriod = (period || 'all').toLowerCase();
  const safeSlug = (slug || '').toLowerCase().trim();
  return `company:v1:${safeRegion}:${safePeriod}:${safeSlug}`;
}

/**
 * Generate cache key for monthly stats
 */
export function statsKey(region: string, period: string): string {
  const safeRegion = (region || 'global').toLowerCase().trim() || 'global';
  return `stats:v1:${safeRegion}:${period}`;
}

/**
 * Generate cache key for available periods
 */
export function periodsKey(region: string): string {
  const safeRegion = (region || 'global').toLowerCase().trim() || 'global';
  return `periods:v1:${safeRegion}`;
}

/**
 * Generate cache key for filter options
 */
export function filterOptionsKey(region: string, period: string): string {
  const safeRegion = (region || 'global').toLowerCase().trim() || 'global';
  return `filters:v1:${safeRegion}:${period}`;
}

/**
 * Generate cache key for news edition queries
 */
export function newsEditionKey(params: {
  region: string;
  date: string;
  topic?: string | null;
  limit: number;
}): string {
  const topicPart = (params.topic || '').toLowerCase().trim() || 'all';
  return `news:v1:edition:${params.region}:${params.date}:${topicPart}:l${params.limit}`;
}

/**
 * Generate cache key for latest news edition date
 */
export function newsLatestDateKey(region: string): string {
  return `news:v1:latest-date:${region}`;
}

/**
 * Generate cache key for latest news edition content (no explicit date)
 */
export function newsLatestKey(region: string, limit: number): string {
  return `news:v1:latest:${region}:l${limit}`;
}

/**
 * Generate cache key for news topics
 */
export function newsTopicsKey(params: { region: string; date: string; limit: number }): string {
  return `news:v1:topics:${params.region}:${params.date}:l${params.limit}`;
}

/**
 * Generate cache key for news archive
 */
export function newsArchiveKey(params: { region: string; limit: number; offset: number }): string {
  return `news:v1:archive:${params.region}:l${params.limit}:o${params.offset}`;
}

/**
 * Generate cache key for active news sources
 */
export function newsSourcesKey(region: string): string {
  return `news:v1:sources:${region}`;
}

/**
 * Generate cache key for a periodic brief (weekly/monthly)
 */
export function newsBriefKey(params: { region: string; periodType: string; date?: string }): string {
  const datePart = params.date || 'latest';
  return `news:v1:brief:${params.region}:${params.periodType}:${datePart}`;
}

/**
 * Generate cache key for periodic brief archive listing
 */
export function newsBriefArchiveKey(params: { region: string; periodType: string; limit: number; offset: number }): string {
  return `news:v1:brief-archive:${params.region}:${params.periodType}:l${params.limit}:o${params.offset}`;
}

// Sort keys recursively so logically equivalent objects hash consistently.
// Note: we preserve array ordering (arrays are not sorted).
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = sortDeep(record[key]);
  }
  return out;
}

/**
 * Hash an object to create a stable cache key component
 */
export function hashObject(obj: object): string {
  const sorted = JSON.stringify(sortDeep(obj));
  // 64-bit truncation: keeps keys short while making collisions vanishingly unlikely in practice.
  return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 16);
}

/**
 * Safely parse a cached JSON string. Returns null on parse failure and
 * schedules deletion of the corrupted key.
 */
export function safeCacheParse<T>(raw: string, key: string, redis: RedisClientType | null): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`Redis: corrupted cache for key ${key}, deleting`);
    if (redis) { redis.del(key).catch(() => {}); }
    return null;
  }
}

// ============================================================================
// Cache Operations
// ============================================================================

export interface CacheResult<T> {
  data: T;
  fromCache: boolean;
}

/**
 * Generic cache wrapper
 *
 * Attempts to get data from cache, falls back to fetch function if miss.
 * Gracefully handles Redis unavailability.
 *
 * @param key Cache key
 * @param ttlSeconds Time-to-live in seconds
 * @param fetchFn Function to fetch data on cache miss
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<CacheResult<T>> {
  const redis = await getRedisClient();

  // Try to get from cache
  if (redis) {
    try {
      const cachedValue = await redis.get(key);
      if (cachedValue) {
        try {
          return {
            data: JSON.parse(cachedValue) as T,
            fromCache: true,
          };
        } catch {
          console.warn(`Redis: corrupted cache value for key ${key}, deleting`);
          try { await redis.del(key); } catch { /* best effort */ }
        }
      }
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
    }
  }

  // Cache miss or Redis unavailable - fetch from source
  const data = await fetchFn();

  // Try to cache the result
  if (redis) {
    try {
      await redis.setEx(key, ttlSeconds, JSON.stringify(data));
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
    }
  }

  return {
    data,
    fromCache: false,
  };
}

/**
 * Invalidate cache keys matching a pattern
 *
 * Use for cache invalidation on data updates.
 * Uses SCAN iteration to avoid blocking Redis.
 *
 * @param pattern Redis key pattern (e.g., "dealbook:v1:*")
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const redis = await getRedisClient();
  if (!redis) {
    return 0;
  }

  try {
    const keys: string[] = [];
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      keys.push(key as string);
    }

    if (keys.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        await redis.del(batch);
      }
      console.log(`Redis: Invalidated ${keys.length} keys matching ${pattern}`);
    }
    return keys.length;
  } catch (error) {
    console.error(`Redis invalidation error for pattern ${pattern}:`, error);
    return 0;
  }
}

/**
 * Invalidate all cached data (nuclear option)
 */
export async function invalidateAll(): Promise<void> {
  await invalidatePattern('dealbook:v1:*');
  await invalidatePattern('company:v1:*');
  await invalidatePattern('stats:v1:*');
  await invalidatePattern('periods:v1:*');
  await invalidatePattern('filters:v1:*');
  await invalidatePattern('news:v1:*');
}

/**
 * Get cache statistics (for debugging/monitoring)
 */
export async function getCacheStats(): Promise<{
  connected: boolean;
  keyCount: number;
  memoryUsed: string;
} | null> {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const info = await redis.info('memory');
    const keyCount = await redis.dbSize();

    // Parse memory from INFO response
    const memoryMatch = info.match(/used_memory_human:(\S+)/);
    const memoryUsed = memoryMatch ? memoryMatch[1] : 'unknown';

    return {
      connected: true,
      keyCount,
      memoryUsed,
    };
  } catch (error) {
    console.error('Redis stats error:', error);
    return null;
  }
}

// ============================================================================
// TTL Constants (centralized for easy adjustment)
// ============================================================================

export const CACHE_TTL = {
  DEALBOOK: 300,      // 5 minutes - frequently accessed, tolerate slight staleness
  STATS: 1800,        // 30 minutes - aggregate data, changes rarely
  PERIODS: 3600,      // 1 hour - period list changes infrequently (monthly)
  FILTERS: 3600,      // 1 hour - filter options very stable
  STARTUP: 600,       // 10 minutes - individual startup data
  NEWS_LATEST_DATE: 120, // 2 minutes - cheap and used as a pointer
  NEWS_EDITION: 300,     // 5 minutes - refreshed daily but read heavily
  NEWS_TOPICS: 300,      // 5 minutes
  NEWS_ARCHIVE: 900,     // 15 minutes
  NEWS_SOURCES: 1800,    // 30 minutes - very stable
  NEWS_BRIEF: 900,       // 15 minutes - generated periodically, read often
  NEWS_BRIEF_ARCHIVE: 1800, // 30 minutes - listing changes infrequently
} as const;

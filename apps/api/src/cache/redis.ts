/**
 * Redis Cache Layer
 *
 * Provides caching for API responses to reduce database load.
 * Gracefully degrades if Redis is unavailable.
 */

import { createClient, RedisClientType } from 'redis';
import crypto from 'crypto';

let client: RedisClientType | null = null;
let connectionAttempted = false;

/**
 * Get Redis client (lazy initialization)
 * Returns null if REDIS_URL not configured or connection fails
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (client?.isReady) {
    return client;
  }

  if (connectionAttempted && !client?.isReady) {
    return null; // Don't retry failed connections on every request
  }

  connectionAttempted = true;

  try {
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
    });

    await client.connect();
    return client;
  } catch (error) {
    console.error('Redis: Connection failed:', error);
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
    client = null;
  }
}

// ============================================================================
// Cache Key Helpers
// ============================================================================

/**
 * Generate cache key for dealbook queries
 */
export function dealBookKey(period: string, page: number, filtersHash: string): string {
  return `dealbook:v1:${period}:p${page}:${filtersHash}`;
}

/**
 * Generate cache key for monthly stats
 */
export function statsKey(period: string): string {
  return `stats:v1:${period}`;
}

/**
 * Generate cache key for filter options
 */
export function filterOptionsKey(period: string): string {
  return `filters:v1:${period}`;
}

/**
 * Hash an object to create a stable cache key component
 */
export function hashObject(obj: object): string {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('md5').update(sorted).digest('hex').slice(0, 8);
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
        return {
          data: JSON.parse(cachedValue) as T,
          fromCache: true,
        };
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
 * Pattern uses Redis KEYS command (use sparingly in production).
 *
 * @param pattern Redis key pattern (e.g., "dealbook:v1:*")
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const redis = await getRedisClient();
  if (!redis) {
    return 0;
  }

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
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
  await invalidatePattern('stats:v1:*');
  await invalidatePattern('filters:v1:*');
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
  FILTERS: 3600,      // 1 hour - filter options very stable
  STARTUP: 600,       // 10 minutes - individual startup data
} as const;

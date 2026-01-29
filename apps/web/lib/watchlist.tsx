'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

// Types
export interface WatchlistItem {
  companySlug: string;
  companyName: string;
  addedAt: string;
  notes?: string;
}

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
  createdAt: string;
  updatedAt: string;
}

interface WatchlistContextType {
  watchlist: Watchlist | null;
  isLoading: boolean;
  isInWatchlist: (companySlug: string) => boolean;
  addToWatchlist: (companySlug: string, companyName: string) => Promise<boolean>;
  removeFromWatchlist: (companySlug: string) => Promise<boolean>;
  requiresAuth: boolean;
  itemCount: number;
  refresh: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

// Storage key for localStorage (used as cache)
const WATCHLIST_CACHE_KEY = 'build_atlas_watchlist_cache';

// Generate a simple ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get cached watchlist from localStorage
function getCachedWatchlist(userId: string): Watchlist | null {
  if (typeof window === 'undefined') return null;

  const key = `${WATCHLIST_CACHE_KEY}_${userId}`;
  const stored = localStorage.getItem(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Save watchlist to localStorage cache
function cacheWatchlist(userId: string, watchlist: Watchlist): void {
  if (typeof window === 'undefined') return;

  const key = `${WATCHLIST_CACHE_KEY}_${userId}`;
  localStorage.setItem(key, JSON.stringify(watchlist));
}

// Create default watchlist structure
function createDefaultWatchlist(items: WatchlistItem[] = []): Watchlist {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: 'My Watchlist',
    items,
    createdAt: now,
    updatedAt: now,
  };
}

interface WatchlistProviderProps {
  children: ReactNode;
}

export function WatchlistProvider({ children }: WatchlistProviderProps) {
  const { data: session, status } = useSession();
  const [watchlist, setWatchlist] = useState<Watchlist | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const userId = session?.user?.id || 'anonymous';
  const isAuthenticated = status === 'authenticated';

  // Fetch watchlist from API
  const fetchWatchlist = useCallback(async () => {
    if (!isAuthenticated) {
      setWatchlist(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/watchlist');

      if (response.ok) {
        const data = await response.json();
        const items: WatchlistItem[] = data.items.map((item: {
          companySlug: string;
          companyName: string;
          addedAt: string;
          notes?: string;
        }) => ({
          companySlug: item.companySlug,
          companyName: item.companyName,
          addedAt: item.addedAt,
          notes: item.notes,
        }));

        const newWatchlist = createDefaultWatchlist(items);
        setWatchlist(newWatchlist);
        cacheWatchlist(userId, newWatchlist);
      } else if (response.status === 401) {
        // Not authenticated - clear watchlist
        setWatchlist(null);
      } else {
        // API error - try to use cached data
        const cached = getCachedWatchlist(userId);
        if (cached) {
          setWatchlist(cached);
        }
      }
    } catch (error) {
      console.error('Failed to fetch watchlist:', error);
      // Use cached data as fallback
      const cached = getCachedWatchlist(userId);
      if (cached) {
        setWatchlist(cached);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, userId]);

  // Load watchlist on mount or when user changes
  useEffect(() => {
    if (status === 'loading') return;

    setIsLoading(true);

    // For authenticated users, first show cached data, then fetch from API
    if (isAuthenticated) {
      const cached = getCachedWatchlist(userId);
      if (cached) {
        setWatchlist(cached);
      }
      fetchWatchlist();
    } else {
      setWatchlist(null);
      setIsLoading(false);
    }
  }, [userId, status, isAuthenticated, fetchWatchlist]);

  // Check if a company is in watchlist
  const isInWatchlist = useCallback((companySlug: string): boolean => {
    if (!watchlist) return false;
    return watchlist.items.some(item => item.companySlug === companySlug);
  }, [watchlist]);

  // Add to watchlist
  const addToWatchlist = useCallback(async (companySlug: string, companyName: string): Promise<boolean> => {
    if (!isAuthenticated) {
      return false;
    }

    // Optimistic update
    const now = new Date().toISOString();
    setWatchlist(current => {
      if (!current) {
        return createDefaultWatchlist([{ companySlug, companyName, addedAt: now }]);
      }

      // Check if already exists
      if (current.items.some(item => item.companySlug === companySlug)) {
        return current;
      }

      return {
        ...current,
        items: [...current.items, { companySlug, companyName, addedAt: now }],
        updatedAt: now,
      };
    });

    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companySlug }),
      });

      if (!response.ok) {
        // Revert optimistic update on failure
        await fetchWatchlist();
        return false;
      }

      // Update cache with current state
      setWatchlist(current => {
        if (current) {
          cacheWatchlist(userId, current);
        }
        return current;
      });

      return true;
    } catch (error) {
      console.error('Failed to add to watchlist:', error);
      // Revert optimistic update
      await fetchWatchlist();
      return false;
    }
  }, [isAuthenticated, userId, fetchWatchlist]);

  // Remove from watchlist
  const removeFromWatchlist = useCallback(async (companySlug: string): Promise<boolean> => {
    if (!isAuthenticated || !watchlist) {
      return false;
    }

    // Optimistic update
    const now = new Date().toISOString();
    setWatchlist(current => {
      if (!current) return null;

      return {
        ...current,
        items: current.items.filter(item => item.companySlug !== companySlug),
        updatedAt: now,
      };
    });

    try {
      const response = await fetch(`/api/watchlist?slug=${encodeURIComponent(companySlug)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        // Revert optimistic update on failure
        await fetchWatchlist();
        return false;
      }

      // Update cache with current state
      setWatchlist(current => {
        if (current) {
          cacheWatchlist(userId, current);
        }
        return current;
      });

      return true;
    } catch (error) {
      console.error('Failed to remove from watchlist:', error);
      // Revert optimistic update
      await fetchWatchlist();
      return false;
    }
  }, [isAuthenticated, watchlist, userId, fetchWatchlist]);

  const value: WatchlistContextType = {
    watchlist,
    isLoading: status === 'loading' || isLoading,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    requiresAuth: !isAuthenticated,
    itemCount: watchlist?.items.length || 0,
    refresh: fetchWatchlist,
  };

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const context = useContext(WatchlistContext);
  if (context === undefined) {
    // Return a default context if used outside provider
    return {
      watchlist: null,
      isLoading: false,
      isInWatchlist: () => false,
      addToWatchlist: async () => false,
      removeFromWatchlist: async () => false,
      requiresAuth: true,
      itemCount: 0,
      refresh: async () => {},
    };
  }
  return context;
}

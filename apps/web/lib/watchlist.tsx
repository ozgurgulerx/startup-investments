'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

// Types
export interface WatchlistItem {
  companySlug: string;
  companyName: string;
  addedAt: string;
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
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

// Storage key for localStorage
const WATCHLIST_KEY = 'build_patterns_watchlist';

// Generate a simple ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Get watchlist from localStorage
function getStoredWatchlist(userId: string): Watchlist | null {
  if (typeof window === 'undefined') return null;

  const key = `${WATCHLIST_KEY}_${userId}`;
  const stored = localStorage.getItem(key);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Save watchlist to localStorage
function saveWatchlist(userId: string, watchlist: Watchlist): void {
  if (typeof window === 'undefined') return;

  const key = `${WATCHLIST_KEY}_${userId}`;
  localStorage.setItem(key, JSON.stringify(watchlist));
}

// Create default watchlist
function createDefaultWatchlist(): Watchlist {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: 'My Watchlist',
    items: [],
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

  // User ID - use session user id or 'anonymous' for localStorage
  const userId = session?.user?.id || 'anonymous';
  const isAuthenticated = status === 'authenticated';

  // Load watchlist on mount or when user changes
  useEffect(() => {
    if (status === 'loading') return;

    setIsLoading(true);

    // For authenticated users, try to load their watchlist
    // For anonymous users, we still allow viewing but show prompt to sign in
    const stored = getStoredWatchlist(userId);

    if (stored) {
      setWatchlist(stored);
    } else if (isAuthenticated) {
      // Create default watchlist for authenticated users
      const defaultWatchlist = createDefaultWatchlist();
      setWatchlist(defaultWatchlist);
      saveWatchlist(userId, defaultWatchlist);
    }

    setIsLoading(false);
  }, [userId, status, isAuthenticated]);

  // Check if a company is in watchlist
  const isInWatchlist = useCallback((companySlug: string): boolean => {
    if (!watchlist) return false;
    return watchlist.items.some(item => item.companySlug === companySlug);
  }, [watchlist]);

  // Add to watchlist
  const addToWatchlist = useCallback(async (companySlug: string, companyName: string): Promise<boolean> => {
    if (!isAuthenticated) {
      return false; // Caller should show sign-in prompt
    }

    const now = new Date().toISOString();

    setWatchlist(current => {
      if (!current) {
        // Create new watchlist
        const newWatchlist: Watchlist = {
          ...createDefaultWatchlist(),
          items: [{ companySlug, companyName, addedAt: now }],
          updatedAt: now,
        };
        saveWatchlist(userId, newWatchlist);
        return newWatchlist;
      }

      // Check if already exists
      if (current.items.some(item => item.companySlug === companySlug)) {
        return current;
      }

      // Add to existing
      const updated: Watchlist = {
        ...current,
        items: [...current.items, { companySlug, companyName, addedAt: now }],
        updatedAt: now,
      };
      saveWatchlist(userId, updated);
      return updated;
    });

    return true;
  }, [isAuthenticated, userId]);

  // Remove from watchlist
  const removeFromWatchlist = useCallback(async (companySlug: string): Promise<boolean> => {
    if (!isAuthenticated || !watchlist) {
      return false;
    }

    const now = new Date().toISOString();

    setWatchlist(current => {
      if (!current) return null;

      const updated: Watchlist = {
        ...current,
        items: current.items.filter(item => item.companySlug !== companySlug),
        updatedAt: now,
      };
      saveWatchlist(userId, updated);
      return updated;
    });

    return true;
  }, [isAuthenticated, watchlist, userId]);

  const value: WatchlistContextType = {
    watchlist,
    isLoading: status === 'loading' || isLoading,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    requiresAuth: !isAuthenticated,
    itemCount: watchlist?.items.length || 0,
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
    };
  }
  return context;
}

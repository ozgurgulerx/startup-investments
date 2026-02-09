'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { normalizeDatasetRegion, type DatasetRegion } from '@/lib/region';

export type Region = DatasetRegion;

const STORAGE_KEY = 'ba_region';

interface RegionContextType {
  region: Region;
  setRegion: (region: Region) => void;
  isLoaded: boolean;
}

const RegionContext = createContext<RegionContextType | undefined>(undefined);

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState<Region>('global');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setRegionState(normalizeDatasetRegion(stored));
    setIsLoaded(true);
  }, []);

  // Persist to localStorage on change — memoized so dependents don't re-fire on every render
  const setRegion = useCallback((newRegion: Region) => {
    setRegionState(newRegion);
    localStorage.setItem(STORAGE_KEY, newRegion);
  }, []);

  return (
    <RegionContext.Provider value={{ region, setRegion, isLoaded }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  const context = useContext(RegionContext);
  if (context === undefined) {
    throw new Error('useRegion must be used within a RegionProvider');
  }
  return context;
}

'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Region = 'global' | 'tr';

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
    if (stored === 'global' || stored === 'tr') {
      setRegionState(stored);
    }
    setIsLoaded(true);
  }, []);

  // Persist to localStorage on change
  const setRegion = (newRegion: Region) => {
    setRegionState(newRegion);
    localStorage.setItem(STORAGE_KEY, newRegion);
  };

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

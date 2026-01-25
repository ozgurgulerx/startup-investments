'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Audience } from './copy';

const STORAGE_KEY = 'ba_audience';

interface AudienceContextType {
  audience: Audience;
  setAudience: (audience: Audience) => void;
  isLoaded: boolean;
}

const AudienceContext = createContext<AudienceContextType | undefined>(undefined);

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [audience, setAudienceState] = useState<Audience>('builders');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'builders' || stored === 'investors') {
      setAudienceState(stored);
    }
    setIsLoaded(true);
  }, []);

  // Persist to localStorage on change
  const setAudience = (newAudience: Audience) => {
    setAudienceState(newAudience);
    localStorage.setItem(STORAGE_KEY, newAudience);
  };

  return (
    <AudienceContext.Provider value={{ audience, setAudience, isLoaded }}>
      {children}
    </AudienceContext.Provider>
  );
}

export function useAudience() {
  const context = useContext(AudienceContext);
  if (context === undefined) {
    throw new Error('useAudience must be used within an AudienceProvider');
  }
  return context;
}

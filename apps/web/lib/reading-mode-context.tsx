'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ReadingMode = 'dark' | 'paper';

const STORAGE_KEY = 'ba_reading_mode';

interface ReadingModeContextType {
  readingMode: ReadingMode;
  setReadingMode: (mode: ReadingMode) => void;
  isLoaded: boolean;
}

const ReadingModeContext = createContext<ReadingModeContextType | undefined>(undefined);

export function ReadingModeProvider({ children }: { children: ReactNode }) {
  const [readingMode, setReadingModeState] = useState<ReadingMode>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'paper') {
      setReadingModeState(stored);
    }
    setIsLoaded(true);
  }, []);

  const setReadingMode = (newMode: ReadingMode) => {
    setReadingModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  };

  return (
    <ReadingModeContext.Provider value={{ readingMode, setReadingMode, isLoaded }}>
      {children}
    </ReadingModeContext.Provider>
  );
}

export function useReadingMode() {
  const context = useContext(ReadingModeContext);
  if (context === undefined) {
    throw new Error('useReadingMode must be used within a ReadingModeProvider');
  }
  return context;
}

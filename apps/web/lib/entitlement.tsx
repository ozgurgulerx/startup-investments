'use client';

import { createContext, useContext, ReactNode } from 'react';
import { type Feature, canAccessFeature } from './pricing';

// Re-export Feature type for convenience
export type { Feature };

interface EntitlementContextType {
  canAccess: (feature: Feature) => boolean;
  isLoading: boolean;
}

const EntitlementContext = createContext<EntitlementContextType | undefined>(undefined);

interface EntitlementProviderProps {
  children: ReactNode;
}

// Simplified provider - all features are open
export function EntitlementProvider({ children }: EntitlementProviderProps) {
  const canAccess = (feature: Feature): boolean => {
    return canAccessFeature(feature);
  };

  return (
    <EntitlementContext.Provider value={{ canAccess, isLoading: false }}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlement() {
  const context = useContext(EntitlementContext);
  if (context === undefined) {
    // Return a default that allows all access if used outside provider
    return {
      canAccess: () => true,
      isLoading: false,
    };
  }
  return context;
}

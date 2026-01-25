'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { FEATURE_ACCESS, type Plan, type Feature } from './pricing';

// Re-export types and constants for convenience
export type { Plan, Feature };
export { PLAN_INFO, PRICING, FEATURE_ACCESS } from './pricing';

interface EntitlementContextType {
  plan: Plan;
  setPlan: (plan: Plan) => void;
  canAccess: (feature: Feature) => boolean;
  isLoading: boolean;
}

const EntitlementContext = createContext<EntitlementContextType | undefined>(undefined);

interface EntitlementProviderProps {
  children: ReactNode;
}

export function EntitlementProvider({ children }: EntitlementProviderProps) {
  const [plan, setPlanState] = useState<Plan>('free');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check environment variable first (for testing)
    const envPlan = process.env.NEXT_PUBLIC_USER_PLAN as Plan;
    if (envPlan && ['free', 'pro', 'team'].includes(envPlan)) {
      setPlanState(envPlan);
      setIsLoading(false);
      return;
    }

    // Check localStorage for persisted plan (demo purposes)
    const storedPlan = localStorage.getItem('user_plan') as Plan;
    if (storedPlan && ['free', 'pro', 'team'].includes(storedPlan)) {
      setPlanState(storedPlan);
    }
    setIsLoading(false);
  }, []);

  const setPlan = (newPlan: Plan) => {
    setPlanState(newPlan);
    localStorage.setItem('user_plan', newPlan);
  };

  const canAccess = (feature: Feature): boolean => {
    return FEATURE_ACCESS[feature]?.includes(plan) ?? false;
  };

  return (
    <EntitlementContext.Provider value={{ plan, setPlan, canAccess, isLoading }}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlement() {
  const context = useContext(EntitlementContext);
  if (context === undefined) {
    throw new Error('useEntitlement must be used within an EntitlementProvider');
  }
  return context;
}

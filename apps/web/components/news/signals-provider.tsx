'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { SignalActionType } from '@startup-intelligence/shared';

interface SignalsContextValue {
  getActions: (clusterId: string) => SignalActionType[];
  toggle: (clusterId: string, action: SignalActionType) => Promise<{ active: boolean; upvote_count: number }>;
  getUpvoteCount: (clusterId: string) => number;
}

const SignalsContext = createContext<SignalsContextValue | null>(null);

export function useSignals(): SignalsContextValue {
  const ctx = useContext(SignalsContext);
  if (!ctx) throw new Error('useSignals must be used within a SignalsProvider');
  return ctx;
}

export function useSignalsOptional(): SignalsContextValue | null {
  return useContext(SignalsContext);
}

interface SignalsProviderProps {
  clusterIds: string[];
  /** Initial upvote counts from server-rendered data, keyed by cluster_id. */
  initialUpvoteCounts?: Record<string, number>;
  children: React.ReactNode;
}

export function SignalsProvider({ clusterIds, initialUpvoteCounts, children }: SignalsProviderProps) {
  const [actionMap, setActionMap] = useState<Record<string, SignalActionType[]>>({});
  const [upvoteCounts, setUpvoteCounts] = useState<Record<string, number>>(initialUpvoteCounts || {});
  const fetchedRef = useRef(false);

  // Batch fetch user's signals on mount
  useEffect(() => {
    if (fetchedRef.current || clusterIds.length === 0) return;
    fetchedRef.current = true;

    fetch('/api/news/signals/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster_ids: clusterIds }),
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, SignalActionType[]>) => {
        setActionMap(data);
      })
      .catch(() => {
        // Silent failure — signals are non-critical
      });
  }, [clusterIds]);

  const getActions = useCallback(
    (clusterId: string): SignalActionType[] => actionMap[clusterId] || [],
    [actionMap]
  );

  const getUpvoteCount = useCallback(
    (clusterId: string): number => upvoteCounts[clusterId] ?? 0,
    [upvoteCounts]
  );

  const toggle = useCallback(
    async (clusterId: string, action: SignalActionType): Promise<{ active: boolean; upvote_count: number }> => {
      // Optimistic update
      setActionMap((prev) => {
        const current = prev[clusterId] || [];
        const has = current.includes(action);
        const next = has ? current.filter((a) => a !== action) : [...current, action];
        return { ...prev, [clusterId]: next };
      });

      if (action === 'upvote') {
        const currentActions = actionMap[clusterId] || [];
        const wasActive = currentActions.includes('upvote');
        setUpvoteCounts((prev) => ({
          ...prev,
          [clusterId]: Math.max(0, (prev[clusterId] ?? 0) + (wasActive ? -1 : 1)),
        }));
      }

      try {
        const res = await fetch('/api/news/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cluster_id: clusterId, action_type: action }),
        });

        if (!res.ok) throw new Error('Failed');
        const result = await res.json() as { active: boolean; upvote_count: number };

        // Reconcile with server truth
        setActionMap((prev) => {
          const current = prev[clusterId] || [];
          const without = current.filter((a) => a !== action);
          return { ...prev, [clusterId]: result.active ? [...without, action] : without };
        });
        setUpvoteCounts((prev) => ({ ...prev, [clusterId]: result.upvote_count }));

        return result;
      } catch {
        // Revert optimistic action map
        setActionMap((prev) => {
          const current = prev[clusterId] || [];
          const has = current.includes(action);
          const reverted = has ? current.filter((a) => a !== action) : [...current, action];
          return { ...prev, [clusterId]: reverted };
        });
        // Revert optimistic upvote count
        if (action === 'upvote') {
          const wasActive = (actionMap[clusterId] || []).includes('upvote');
          setUpvoteCounts((prev) => ({
            ...prev,
            [clusterId]: Math.max(0, (prev[clusterId] ?? 0) + (wasActive ? 1 : -1)),
          }));
        }
        return { active: false, upvote_count: upvoteCounts[clusterId] ?? 0 };
      }
    },
    [actionMap, upvoteCounts]
  );

  return (
    <SignalsContext.Provider value={{ getActions, toggle, getUpvoteCount }}>
      {children}
    </SignalsContext.Provider>
  );
}

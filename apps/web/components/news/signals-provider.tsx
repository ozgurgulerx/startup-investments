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
  const lastFetchedKeyRef = useRef<string>('');

  // Refs for synchronous reads/writes inside the stable toggle callback
  const actionMapRef = useRef(actionMap);
  actionMapRef.current = actionMap;
  const upvoteCountsRef = useRef(upvoteCounts);
  upvoteCountsRef.current = upvoteCounts;

  // Re-sync upvote counts when server data changes (e.g. edition refresh)
  useEffect(() => {
    const nextCounts = initialUpvoteCounts || {};
    upvoteCountsRef.current = nextCounts;
    setUpvoteCounts(nextCounts);
  }, [initialUpvoteCounts]);

  // Batch fetch user's signals when cluster IDs change
  useEffect(() => {
    if (clusterIds.length === 0) return;
    const key = clusterIds.slice().sort().join(',');
    if (lastFetchedKeyRef.current === key) return;
    lastFetchedKeyRef.current = key;

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
      const currentActions = actionMapRef.current[clusterId] || [];
      const wasActive = currentActions.includes(action);
      const optimisticActions = wasActive
        ? currentActions.filter((a) => a !== action)
        : [...currentActions, action];

      actionMapRef.current = {
        ...actionMapRef.current,
        [clusterId]: optimisticActions,
      };

      // Optimistic update
      setActionMap((prev) => ({ ...prev, [clusterId]: optimisticActions }));

      if (action === 'upvote') {
        const optimisticCount = Math.max(
          0,
          (upvoteCountsRef.current[clusterId] ?? 0) + (wasActive ? -1 : 1)
        );
        upvoteCountsRef.current = {
          ...upvoteCountsRef.current,
          [clusterId]: optimisticCount,
        };
        setUpvoteCounts((prev) => ({ ...prev, [clusterId]: optimisticCount }));
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
          const nextActions = result.active ? [...without, action] : without;
          actionMapRef.current = {
            ...actionMapRef.current,
            [clusterId]: nextActions,
          };
          return { ...prev, [clusterId]: nextActions };
        });
        upvoteCountsRef.current = {
          ...upvoteCountsRef.current,
          [clusterId]: result.upvote_count,
        };
        setUpvoteCounts((prev) => ({ ...prev, [clusterId]: result.upvote_count }));

        return result;
      } catch {
        const current = actionMapRef.current[clusterId] || [];
        const has = current.includes(action);
        const revertedActions = has
          ? current.filter((a) => a !== action)
          : [...current, action];
        actionMapRef.current = {
          ...actionMapRef.current,
          [clusterId]: revertedActions,
        };

        // Revert optimistic action map
        setActionMap((prev) => ({ ...prev, [clusterId]: revertedActions }));

        // Revert optimistic upvote count
        if (action === 'upvote') {
          const revertCount = Math.max(
            0,
            (upvoteCountsRef.current[clusterId] ?? 0) + (has ? -1 : 1)
          );
          upvoteCountsRef.current = {
            ...upvoteCountsRef.current,
            [clusterId]: revertCount,
          };
          setUpvoteCounts((prev) => ({ ...prev, [clusterId]: revertCount }));
        }

        return { active: false, upvote_count: upvoteCountsRef.current[clusterId] ?? 0 };
      }
    },
    []
  );

  return (
    <SignalsContext.Provider value={{ getActions, toggle, getUpvoteCount }}>
      {children}
    </SignalsContext.Provider>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Neighbor {
  id: string;
  name: string;
  slug: string;
  vertical: string | null;
  stage: string | null;
  rank: number;
  overall_score: number;
  shared_patterns: string[];
}

interface ComparableStartupsProps {
  slug: string;
  region?: string;
}

export function ComparableStartups({ slug, region }: ComparableStartupsProps) {
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [method, setMethod] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams({ limit: '8' });
    if (region && region !== 'global') params.set('region', region);
    fetch(`/api/v1/companies/${encodeURIComponent(slug)}/neighbors?${params}`)
      .then((res) => (res.ok ? res.json() : { neighbors: [], method: '' }))
      .then((data) => {
        if (data.neighbors) setNeighbors(data.neighbors);
        if (data.method) setMethod(data.method);
      })
      .catch(() => {});
  }, [slug, region]);

  if (neighbors.length === 0) return null;

  const methodLabel = method === 'hybrid'
    ? 'Based on architecture profile'
    : method === 'pattern_meta'
      ? 'Based on shared patterns'
      : method === 'fallback'
        ? 'Based on available data'
        : '';

  return (
    <section className="section">
      <div className="section-header">
        <span className="section-title">Comparable Startups</span>
        {methodLabel && (
          <span className="text-[10px] text-muted-foreground/60">{methodLabel}</span>
        )}
      </div>

      <div className="space-y-2">
        {neighbors.map((n) => (
          <Link
            key={n.id}
            href={`/company/${n.slug}`}
            className="flex items-center gap-3 py-2 group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors truncate">
                  {n.name}
                </span>
                {n.stage && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground shrink-0">
                    {n.stage}
                  </span>
                )}
              </div>
              {n.shared_patterns.length > 0 && (
                <div className="flex items-center gap-1 mt-1">
                  {n.shared_patterns.slice(0, 3).map((p) => (
                    <span
                      key={p}
                      className="text-[9px] px-1 py-0.5 rounded border border-border/30 text-muted-foreground/70"
                    >
                      {p}
                    </span>
                  ))}
                  {n.shared_patterns.length > 3 && (
                    <span className="text-[9px] text-muted-foreground/50">
                      +{n.shared_patterns.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Similarity score bar */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent/50"
                  style={{ width: `${Math.round(n.overall_score * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums w-8 text-right">
                {(n.overall_score * 100).toFixed(0)}%
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

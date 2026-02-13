'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRegion } from '@/lib/region-context';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { SectorFilter } from '@/components/features/sector-filter';

interface TreemapNode {
  name: string;
  value: number;
  count: number;
  funding: number;
  children?: TreemapNode[];
  startups?: Array<{ id: string; name: string; slug: string; funding: number }>;
}

interface ClusterDetail {
  pattern: string;
  startup_count: number;
  total_funding: number;
  top_startups: Array<{ id: string; name: string; slug: string; funding: number; stage: string | null }>;
  top_investors: Array<{ name: string; deal_count: number }>;
  related_patterns: string[];
}

const COLORS = [
  'var(--accent-info)', 'var(--muted-foreground)',
  'hsl(var(--accent-info-hsl) / 0.7)', 'hsl(var(--accent-info-hsl) / 0.4)',
  'hsl(220 10% 40%)', 'hsl(220 10% 30%)', 'hsl(220 10% 50%)',
  'hsl(220 10% 35%)', 'hsl(220 10% 45%)', 'hsl(220 10% 25%)',
];

function formatUsd(v: number): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, count, funding, index, depth } = props;
  // Recharts always renders an artificial root node (depth 0) without our custom fields.
  // Skip it to avoid "undefined.toFixed" crashes and prevent a full-size overlay tile.
  if (depth === 0) return null;
  if (width < 40 || height < 30) return null;
  const color = COLORS[index % COLORS.length];
  const safeName = typeof name === 'string' ? name : '';
  const safeCount = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  const safeFunding = typeof funding === 'number' && Number.isFinite(funding) ? funding : 0;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} opacity={0.25} stroke="var(--border)" strokeWidth={1} rx={2} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 6} y={y + 16} fill="var(--foreground)" fontSize={11} fontWeight={500}>
            {safeName.length > width / 7 ? safeName.slice(0, Math.floor(width / 7)) + '...' : safeName}
          </text>
          <text x={x + 6} y={y + 30} fill="var(--muted-foreground)" fontSize={9}>
            {safeCount} startups · {formatUsd(safeFunding)}
          </text>
        </>
      )}
    </g>
  );
}

async function extractErrorMessage(res: Response): Promise<string | null> {
  try {
    const text = (await res.text()).trim();
    if (!text) return null;

    // Prefer `{ error: string }` JSON bodies from our API proxy routes.
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        const msg = (json as any).error;
        if (typeof msg === 'string' && msg.trim()) return msg.trim();
      }
      // If it's an array/object without an error field, don't show it to users.
      return null;
    } catch {
      // Non-JSON responses: fall back to plain text if it looks meaningful.
      return text;
    }
  } catch {
    return null;
  }
}

export default function LandscapesPage() {
  const { region } = useRegion();
  const [nodes, setNodes] = useState<TreemapNode[]>([]);
  const [sizeBy, setSizeBy] = useState<'funding' | 'count'>('funding');
  const [sector, setSector] = useState<string | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);
  const [clusterDetail, setClusterDetail] = useState<ClusterDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        const params = new URLSearchParams({ size_by: sizeBy });
        if (region !== 'global') params.set('scope', region);
        if (sector) params.set('sector', sector);
        const res = await fetch(`/api/landscapes?${params.toString()}`);
        if (res.ok) {
          setNodes(await res.json());
        } else {
          setNodes([]);
          const msg = await extractErrorMessage(res);
          setLoadError(msg ? `${msg} (HTTP ${res.status})` : `Failed to load landscapes (HTTP ${res.status})`);
        }
      } catch (err) {
        console.error('Failed to load landscapes:', err);
        setNodes([]);
        setLoadError('Failed to load landscapes');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [region, sizeBy, sector]);

  useEffect(() => {
    if (!selectedPattern) {
      setClusterDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    async function loadDetail() {
      try {
        setDetailLoading(true);
        setDetailError(null);
        setClusterDetail(null);
        const scope = region !== 'global' ? `&scope=${region}` : '';
        const res = await fetch(`/api/landscapes/cluster?pattern=${encodeURIComponent(selectedPattern!)}${scope}`);
        if (res.ok) {
          setClusterDetail(await res.json());
        } else if (res.status === 404) {
          setDetailError('No details available for this pattern.');
        } else {
          const msg = await extractErrorMessage(res);
          setDetailError(msg ? `${msg} (HTTP ${res.status})` : `Failed to load details (HTTP ${res.status})`);
        }
      } catch (err) {
        console.error('Failed to load cluster detail:', err);
        setDetailError('Failed to load details');
      } finally {
        setDetailLoading(false);
      }
    }
    loadDetail();
  }, [selectedPattern, region]);

  const treemapData = useMemo(() => {
    return nodes.map((n, i) => ({
      ...n,
      fill: COLORS[i % COLORS.length],
    }));
  }, [nodes]);

  if (loading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Landscapes</span>
          <h1 className="briefing-headline">Pattern landscape map</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="briefing-header">
        <span className="briefing-date">Landscapes</span>
        <h1 className="briefing-headline">Pattern landscape map</h1>
        {loadError ? (
          <p className="text-sm text-destructive mt-1">{loadError}</p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            {nodes.length} patterns across {nodes.reduce((s, n) => s + n.count, 0)} startups
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3 mt-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Size by:</span>
            {(['funding', 'count'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setSizeBy(opt)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  sizeBy === opt ? 'bg-accent-info/15 text-accent-info' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt === 'funding' ? 'Funding' : 'Count'}
              </button>
            ))}
          </div>
        </div>
        <SectorFilter region={region} value={sector} onChange={setSector} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Treemap */}
        <div className="border border-border/30 rounded-lg p-2 min-h-[400px]">
          {treemapData.length > 0 ? (
            <ResponsiveContainer width="100%" height={420}>
              <Treemap
                data={treemapData}
                dataKey="value"
                aspectRatio={4/3}
                stroke="var(--border)"
                content={<TreemapContent />}
                onClick={(node: any) => node?.name && setSelectedPattern(node.name)}
              />
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[420px] text-sm text-muted-foreground">
              No landscape data available
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="border border-border/30 rounded-lg p-4">
          {!selectedPattern ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-16">
              Click a pattern cell to see details
            </div>
          ) : detailLoading ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-16">
              Loading details...
            </div>
          ) : detailError ? (
            <div className="flex items-center justify-center h-full text-xs text-destructive py-16 text-center">
              {detailError}
            </div>
          ) : clusterDetail ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">{clusterDetail.pattern}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{clusterDetail.startup_count} startups</span>
                  <span>{formatUsd(clusterDetail.total_funding)}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Top Startups</h4>
                <div className="space-y-1.5">
                  {clusterDetail.top_startups.slice(0, 8).map(s => (
                    <Link
                      key={s.id}
                      href={`/company/${s.slug}`}
                      className="flex items-center justify-between text-xs hover:text-accent-info transition-colors"
                    >
                      <span className="text-foreground truncate">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums ml-2">{formatUsd(s.funding)}</span>
                    </Link>
                  ))}
                </div>
              </div>

              {clusterDetail.top_investors.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Top Investors</h4>
                  <div className="space-y-1">
                    {clusterDetail.top_investors.slice(0, 5).map(inv => (
                      <div key={inv.name} className="flex items-center justify-between text-xs">
                        <span className="text-foreground truncate">{inv.name}</span>
                        <span className="text-muted-foreground/60 ml-2">{inv.deal_count} deals</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {clusterDetail.related_patterns.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Related Patterns</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {clusterDetail.related_patterns.map(p => (
                      <button
                        key={p}
                        onClick={() => setSelectedPattern(p)}
                        className="px-2 py-0.5 text-[10px] bg-muted/20 text-muted-foreground rounded hover:text-accent-info transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-16 text-center">
              No details available for this pattern.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

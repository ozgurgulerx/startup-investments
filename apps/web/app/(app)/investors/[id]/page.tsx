'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRegion } from '@/lib/region-context';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface InvestorDNA {
  investor_id: string;
  investor_name: string;
  investor_type: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  median_check_usd: number | null;
  pattern_deal_counts: Record<string, number>;
  pattern_amounts: Record<string, number>;
  stage_deal_counts: Record<string, number>;
  thesis_shift_js: number | null;
  top_gainers: Array<{ pattern: string; delta_pp: number }> | null;
  top_partners: Array<{ investor_id: string; name: string; co_deals: number }>;
}

interface PortfolioItem {
  startup_id: string;
  name: string;
  slug: string;
  stage: string | null;
  patterns: string[];
  amount_usd: number | null;
  round_type: string;
}

interface InvestorNetworkNode {
  id: string;
  type: 'investor' | 'startup';
  name: string;
  slug?: string;
  meta?: Record<string, unknown>;
}

interface InvestorNetworkEdge {
  id: string;
  src_id: string;
  dst_id: string;
  edge_type: string;
  meta?: Record<string, unknown>;
}

interface InvestorNetwork {
  investor_id: string;
  scope: string;
  depth: number;
  nodes: InvestorNetworkNode[];
  edges: InvestorNetworkEdge[];
}

interface InvestorNewsItem {
  cluster_id: string;
  published_at: string;
  title: string;
  canonical_url: string | null;
  startup: { id: string; name: string; slug: string | null };
  round: { round_type: string | null; amount_usd: number | null; announced_date: string | null };
}

interface InvestorNewsResponse {
  investor_id: string;
  scope: string;
  days: number;
  total: number;
  items: InvestorNewsItem[];
}

const CHART_COLORS = [
  'hsl(220 10% 50%)', 'hsl(220 10% 40%)', 'hsl(220 10% 60%)',
  'hsl(220 10% 35%)', 'hsl(220 10% 55%)', 'hsl(220 10% 45%)',
  'hsl(220 10% 30%)', 'hsl(220 10% 65%)',
];

function formatUsd(v: number | null): string {
  if (v == null) return '-';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatShortDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function InvestorProfilePage() {
  const params = useParams();
  const { region } = useRegion();
  const investorId = params.id as string;
  const [dna, setDna] = useState<InvestorDNA | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [network, setNetwork] = useState<InvestorNetwork | null>(null);
  const [news, setNews] = useState<InvestorNewsItem[]>([]);
  const [newsTotal, setNewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setNetwork(null);
      setNews([]);
      setNewsTotal(0);
      try {
        const scopeQs = region !== 'global' ? `scope=${region}` : '';
        const dnaUrl = `/api/investors/${investorId}/dna${scopeQs ? `?${scopeQs}` : ''}`;
        const portfolioUrl = `/api/investors/${investorId}/portfolio${scopeQs ? `?${scopeQs}` : ''}`;

        const networkQs = new URLSearchParams();
        if (region !== 'global') networkQs.set('scope', region);
        networkQs.set('depth', '2');
        networkQs.set('limit', '25');
        const networkUrl = `/api/investors/${investorId}/network?${networkQs.toString()}`;

        const newsQs = new URLSearchParams({ scope: region, days: '30', limit: '12', offset: '0' });
        const newsUrl = `/api/investors/${investorId}/news?${newsQs.toString()}`;

        const [dnaRes, portRes, netRes, newsRes] = await Promise.all([
          fetch(dnaUrl),
          fetch(portfolioUrl),
          fetch(networkUrl),
          fetch(newsUrl),
        ]);
        if (dnaRes.ok) setDna(await dnaRes.json());
        if (portRes.ok) {
          const data = await portRes.json();
          setPortfolio(data.portfolio || []);
        }
        if (netRes.ok) {
          setNetwork(await netRes.json());
        } else {
          setNetwork(null);
        }
        if (newsRes.ok) {
          const data = (await newsRes.json()) as InvestorNewsResponse;
          setNews(data.items || []);
          setNewsTotal(data.total || 0);
        }
      } catch (err) {
        console.error('Failed to load investor:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [investorId, region]);

  const patternChartData = useMemo(() => {
    if (!dna) return [];
    return Object.entries(dna.pattern_deal_counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [dna]);

  const stageChartData = useMemo(() => {
    if (!dna) return [];
    return Object.entries(dna.stage_deal_counts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value }));
  }, [dna]);

  const graphPartners = useMemo(() => {
    if (!network) return [];
    const nodesById = new Map(network.nodes.map(n => [n.id, n]));

    return network.edges
      .filter(e => e.edge_type === 'CO_INVESTS_WITH' && e.src_id === network.investor_id)
      .map(e => {
        const node = nodesById.get(e.dst_id);
        const coDeals = Number((e.meta as { co_deals?: unknown } | undefined)?.co_deals || 0);
        const coAmountUsd = (e.meta as { co_amount_usd?: unknown } | undefined)?.co_amount_usd;
        return {
          investor_id: e.dst_id,
          name: String(node?.name || 'Unknown'),
          co_deals: Number.isFinite(coDeals) ? coDeals : 0,
          co_amount_usd: typeof coAmountUsd === 'number' ? coAmountUsd : null,
        };
      })
      .filter(p => p.investor_id !== network.investor_id)
      .sort((a, b) => b.co_deals - a.co_deals)
      .slice(0, 10);
  }, [network]);

  if (loading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Investor Profile</span>
          <h1 className="briefing-headline">Loading...</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </>
    );
  }

  if (!dna) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Investor Profile</span>
          <h1 className="briefing-headline">Investor not found</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-4">No DNA data available for this investor.</p>
      </>
    );
  }

  return (
    <>
      <div className="briefing-header">
        <span className="briefing-date">Investor Profile</span>
        <h1 className="briefing-headline">{dna.investor_name}</h1>
        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
          {dna.investor_type && <span className="capitalize">{dna.investor_type}</span>}
          <span>{dna.deal_count} deals</span>
          <span>{formatUsd(dna.total_amount_usd)} total</span>
          <span>{dna.lead_count} led</span>
          {dna.median_check_usd && <span>Median check: {formatUsd(dna.median_check_usd)}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Pattern Mix */}
        <div className="p-4 border border-border/30 rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-3">Pattern Mix</h3>
          {patternChartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={patternChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                    {patternChartData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-8 text-center">No pattern data</p>
          )}
          <div className="space-y-1 mt-2">
            {patternChartData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-foreground flex-1 truncate">{d.name}</span>
                <span className="text-muted-foreground tabular-nums">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stage Mix */}
        <div className="p-4 border border-border/30 rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-3">Stage Mix</h3>
          <div className="space-y-2">
            {stageChartData.map(d => {
              const total = stageChartData.reduce((s, x) => s + x.value, 0);
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <div key={d.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-foreground capitalize">{d.name.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground tabular-nums">{d.value} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
                    <div className="h-full bg-muted-foreground/40 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Thesis Shift */}
          {dna.thesis_shift_js != null && (
            <div className="mt-4 pt-4 border-t border-border/20">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Thesis Shift</h4>
              <span className="text-lg tabular-nums text-foreground">{(dna.thesis_shift_js * 100).toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground ml-2">JS divergence vs prev quarter</span>
              {dna.top_gainers && dna.top_gainers.length > 0 && (
                <div className="mt-2 space-y-1">
                  {dna.top_gainers.map(g => (
                    <div key={g.pattern} className="text-xs text-muted-foreground">
                      <span className="text-accent-info">+{g.delta_pp.toFixed(1)}pp</span> {g.pattern}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Top Co-Investors */}
      {dna.top_partners.length > 0 && (
        <div className="mt-6 p-4 border border-border/30 rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-3">Top Co-Investors</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {dna.top_partners.map(p => (
              <Link
                key={p.investor_id}
                href={`/investors/${p.investor_id}`}
                className="p-2 text-xs border border-border/20 rounded hover:border-accent-info/30 transition-colors"
              >
                <div className="text-foreground truncate">{p.name}</div>
                <div className="text-muted-foreground/60 mt-0.5">{p.co_deals} co-deals</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Network (Graph) */}
      {network && (
        <div className="mt-6 p-4 border border-border/30 rounded-lg">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-sm font-medium text-foreground">Network (Graph)</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {network.nodes.length} nodes · {network.edges.length} edges
            </span>
          </div>

          {graphPartners.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {graphPartners.map(p => (
                <Link
                  key={p.investor_id}
                  href={`/investors/${p.investor_id}`}
                  className="p-2 text-xs border border-border/20 rounded hover:border-accent-info/30 transition-colors"
                >
                  <div className="text-foreground truncate">{p.name}</div>
                  <div className="text-muted-foreground/60 mt-0.5">{p.co_deals} co-deals</div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2">No co-invest edges found in the graph yet.</p>
          )}
        </div>
      )}

      {/* Portfolio */}
      <div className="mt-6 p-4 border border-border/30 rounded-lg">
        <h3 className="text-sm font-medium text-foreground mb-3">Portfolio ({portfolio.length})</h3>
        <div className="space-y-1.5">
          {portfolio.map(s => (
            <Link
              key={s.startup_id}
              href={`/company/${s.slug}`}
              className="flex items-center justify-between py-1.5 text-xs hover:text-accent-info transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-foreground">{s.name}</span>
                {s.stage && <span className="text-muted-foreground/60 capitalize">{s.stage.replace(/_/g, ' ')}</span>}
              </div>
              <div className="flex items-center gap-2">
                {s.patterns.length > 0 && (
                  <span className="text-muted-foreground/50 truncate max-w-[120px]">{s.patterns[0]}</span>
                )}
                <span className="text-muted-foreground tabular-nums">{formatUsd(s.amount_usd)}</span>
              </div>
            </Link>
          ))}
          {portfolio.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No portfolio data available</p>
          )}
        </div>
      </div>

      {/* Recent funding news */}
      <div className="mt-6 p-4 border border-border/30 rounded-lg">
        <h3 className="text-sm font-medium text-foreground mb-3">
          Recent funding news {newsTotal > 0 ? `(${newsTotal})` : ''}
        </h3>
        <div className="space-y-2">
          {news.map(item => (
            <div key={item.cluster_id} className="text-xs">
              <div className="flex items-start justify-between gap-3">
                <a
                  href={item.canonical_url || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-foreground hover:text-accent-info transition-colors ${item.canonical_url ? '' : 'pointer-events-none opacity-80'}`}
                >
                  {item.title}
                </a>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {formatShortDate(item.published_at)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-muted-foreground/80">
                {item.startup?.slug ? (
                  <Link href={`/company/${item.startup.slug}`} className="hover:text-accent-info transition-colors">
                    {item.startup.name}
                  </Link>
                ) : (
                  <span>{item.startup?.name || 'Unknown startup'}</span>
                )}
                {item.round?.round_type && (
                  <span className="capitalize">{item.round.round_type}</span>
                )}
                {item.round?.amount_usd != null && (
                  <span className="tabular-nums">{formatUsd(item.round.amount_usd)}</span>
                )}
              </div>
            </div>
          ))}
          {news.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No recent funding news found.</p>
          )}
        </div>
      </div>
    </>
  );
}

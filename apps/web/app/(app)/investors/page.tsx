'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRegion } from '@/lib/region-context';

interface InvestorItem {
  investor_id: string;
  name: string;
  type: string | null;
  country: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  top_patterns: string[];
  thesis_shift_js: number | null;
  news_count: number;
  last_news_at?: string | null;
}

function formatUsd(v: number | null): string {
  if (v == null) return '-';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SORT_OPTIONS = [
  { value: 'deal_count', label: 'Deals' },
  { value: 'total_amount', label: 'Total $' },
  { value: 'thesis_shift', label: 'Thesis Shift' },
  { value: 'lead_rate', label: 'Lead Rate' },
];

export default function InvestorsPage() {
  const { region } = useRegion();
  const [investors, setInvestors] = useState<InvestorItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState('deal_count');
  const [patternFilter, setPatternFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ sort, scope: region });
        if (patternFilter) params.set('pattern', patternFilter);
        const res = await fetch(`/api/investors/screener?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setInvestors(data.investors || []);
          setTotal(data.total || 0);
        } else {
          setInvestors([]);
          setTotal(0);
          setError(`Failed to load investor screener (${res.status})`);
        }
      } catch (err) {
        console.error('Failed to load investors:', err);
        setInvestors([]);
        setTotal(0);
        setError('Failed to load investor screener');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [region, sort, patternFilter]);

  return (
    <>
      <div className="briefing-header">
        <span className="briefing-date">Investors</span>
        <h1 className="briefing-headline">Investor DNA screener</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total} investors with pattern exposure data
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mt-4 mb-6">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sort:</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                sort === opt.value ? 'bg-accent-info/15 text-accent-info' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by pattern..."
          value={patternFilter}
          onChange={e => setPatternFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-transparent border border-border/30 rounded text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent-info/50 w-48"
        />
      </div>

      {/* Investor Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          {error}
        </div>
      ) : (
        <div className="space-y-2">
          {investors.map(inv => (
            <Link
              key={inv.investor_id}
              href={`/investors/${inv.investor_id}`}
              className="block p-4 border border-border/30 rounded-lg hover:border-accent-info/30 transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{inv.name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {inv.type && <span className="capitalize">{inv.type}</span>}
                    {inv.country && <span>{inv.country}</span>}
                    <span>{inv.deal_count} deals</span>
                    <span>{formatUsd(inv.total_amount_usd)}</span>
                    {inv.lead_count > 0 && <span>{inv.lead_count} led</span>}
                    {inv.news_count > 0 && (
                      <span>
                        {inv.news_count} news{inv.last_news_at ? ` · ${formatShortDate(inv.last_news_at)}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                {inv.thesis_shift_js != null && inv.thesis_shift_js > 0.01 && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-accent-info/10 text-accent-info rounded">
                    shift {(inv.thesis_shift_js * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {inv.top_patterns.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {inv.top_patterns.map(p => (
                    <span key={p} className="px-2 py-0.5 text-[10px] bg-muted/20 text-muted-foreground rounded">
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
          {investors.length === 0 && (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No investors found with current filters
            </div>
          )}
        </div>
      )}
    </>
  );
}

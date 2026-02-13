'use client';

import { useState, useCallback, useRef, type FormEvent } from 'react';
import { safeHref } from '@/lib/url';

interface SearchResult {
  id: string;
  title: string;
  summary: string;
  story_type: string;
  topic_tags: string[];
  entities: string[];
  published_at: string;
  similarity: number;
  primary_url?: string;
  primary_source?: string;
  image_url?: string;
}

const storyTypeLabelsEn: Record<string, string> = {
  funding: 'Funding',
  launch: 'Launch',
  mna: 'M&A',
  regulation: 'Regulation',
  news: 'News',
  opinion: 'Opinion',
  analysis: 'Analysis',
};

const storyTypeLabelsTr: Record<string, string> = {
  funding: 'Yatirim',
  launch: 'Lansman',
  mna: 'Satinalma',
  regulation: 'Regulasyon',
  news: 'Haber',
  opinion: 'Gorus',
  analysis: 'Analiz',
};

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function NewsSearchView({ region }: { region: 'global' | 'turkey' }) {
  const isTR = region === 'turkey';
  const locale = isTR ? 'tr-TR' : 'en-US';
  const l = isTR
    ? {
      placeholder: "Sinyal ara... (orn. 'AI ajan yatirim turu')",
      allTypes: 'Tum tipler',
      funding: 'Yatirim',
      launch: 'Lansman',
      regulation: 'Regulasyon',
      general: 'Genel',
      search: 'Ara',
      searching: 'Araniyor...',
      noResults: 'Sonuc bulunamadi. Farkli bir sorgu deneyin veya filtreleri genisletin.',
      result: 'sonuc',
      results: 'sonuc',
    }
    : {
      placeholder: "Search signals... (e.g. 'AI agent funding round')",
      allTypes: 'All types',
      funding: 'Funding',
      launch: 'Launch',
      regulation: 'Regulation',
      general: 'General',
      search: 'Search',
      searching: 'Searching...',
      noResults: 'No results found. Try a different query or broaden your filters.',
      result: 'result',
      results: 'results',
    };
  const storyTypeLabels = isTR ? storyTypeLabelsTr : storyTypeLabelsEn;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filters, setFilters] = useState({ story_type: '', date_from: '', date_to: '' });
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const qs = new URLSearchParams();
      qs.set('q', q.trim());
      qs.set('region', region);
      qs.set('limit', '30');
      if (filters.story_type) qs.set('story_type', filters.story_type);
      if (filters.date_from) qs.set('date_from', filters.date_from);
      if (filters.date_to) qs.set('date_to', filters.date_to);
      const res = await fetch(`/api/news/search?${qs.toString()}`);
      if (res.ok) setResults(await res.json());
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [region, filters]);

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); doSearch(query); };

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={l.placeholder}
            className="w-full h-10 pl-10 pr-4 text-sm bg-muted/25 border border-border/40 rounded-lg placeholder:text-muted-foreground/50 text-foreground focus:outline-none focus:border-accent-info/55 focus:bg-muted/45 transition-colors"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={filters.story_type}
            onChange={(e) => setFilters((f) => ({ ...f, story_type: e.target.value }))}
            className="h-7 rounded-md border border-border/40 bg-muted/20 px-2 text-xs text-muted-foreground"
          >
            <option value="">{l.allTypes}</option>
            <option value="funding">{l.funding}</option>
            <option value="launch">{l.launch}</option>
            <option value="mna">M&amp;A</option>
            <option value="regulation">{l.regulation}</option>
            <option value="news">{l.general}</option>
          </select>
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
            className="h-7 rounded-md border border-border/40 bg-muted/20 px-2 text-xs text-muted-foreground"
          />
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
            className="h-7 rounded-md border border-border/40 bg-muted/20 px-2 text-xs text-muted-foreground"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-7 rounded-md border border-accent-info/40 bg-accent-info/10 px-3 text-xs text-accent-info hover:bg-accent-info/20 transition-colors disabled:opacity-50"
          >
            {loading ? l.searching : l.search}
          </button>
        </div>
      </form>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          {l.searching}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <p className="py-8 text-sm text-muted-foreground">
          {l.noResults}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{results.length} {results.length !== 1 ? l.results : l.result}</p>
          {results.map((r) => (
            <a
              key={r.id}
              href={safeHref(r.primary_url) || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border/30 bg-muted/10 p-4 hover:border-border/50 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-foreground line-clamp-2">{r.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.summary}</p>
                </div>
                {r.image_url && (
                  <img src={r.image_url} alt="" className="h-12 w-16 flex-shrink-0 rounded object-cover" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="rounded-full bg-accent-info/10 px-2 py-0.5 text-accent-info">
                  {storyTypeLabels[r.story_type] || r.story_type}
                </span>
                <span className="text-muted-foreground/60">{formatDate(r.published_at, locale)}</span>
                {r.primary_source && (
                  <span className="text-muted-foreground/60">{r.primary_source}</span>
                )}
                {r.entities.slice(0, 3).map((e) => (
                  <span key={e} className="text-muted-foreground/50">{e}</span>
                ))}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

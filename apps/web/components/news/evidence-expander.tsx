'use client';

import { useState } from 'react';
import { ChevronDown, Lock, ExternalLink } from 'lucide-react';
import type { EvidenceItem } from '@startup-intelligence/shared';
import { timeAgo } from '@/lib/news-utils';

interface EvidenceExpanderProps {
  evidence: EvidenceItem[];
  defaultCollapsed?: boolean;
  region?: 'global' | 'turkey';
  isInvestigation?: boolean;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function toExternalHref(value?: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Invalid/relative URLs are not rendered as external links.
  }
  return null;
}

function EvidenceRow({ item, region }: { item: EvidenceItem; region: 'global' | 'turkey' }) {
  const href = toExternalHref(item.url) || toExternalHref(item.canonical_url);
  const domain = href ? hostFromUrl(href) : null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex items-center gap-1 font-medium text-accent-info/90 hover:text-accent-info transition-colors"
          title={href}
        >
          <span className="truncate max-w-[140px]">{item.publisher}</span>
          {domain ? <span className="text-[10px] text-muted-foreground/70">({domain})</span> : null}
        </a>
      ) : (
        <span className="font-medium text-foreground/80 truncate max-w-[140px]">
          {item.publisher}
        </span>
      )}
      {item.published_at && (
        <>
          <span className="text-muted-foreground/40">&middot;</span>
          <span className="text-muted-foreground/60 tabular-nums whitespace-nowrap">
            {timeAgo(item.published_at, region)}
          </span>
        </>
      )}
      {item.paywalled && (
        <Lock className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto inline-flex items-center gap-0.5 text-accent-info/70 hover:text-accent-info transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export function EvidenceExpander({
  evidence,
  defaultCollapsed = true,
  region = 'global',
  isInvestigation = false,
}: EvidenceExpanderProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const l = region === 'turkey'
    ? {
      sources: 'Kaynaklar',
      more: 'daha fazla',
      showLess: 'Daha az goster',
      note: 'BuildAtlas kaynaklari ozetler ve atif yapar. Tam baglam icin orijinal metni okuyun.',
    }
    : {
      sources: 'Sources',
      more: 'more',
      showLess: 'Show less',
      note: 'BuildAtlas paraphrases and cites sources. Read originals for full context.',
    };

  if (!evidence || evidence.length === 0) return null;

  const deduped = evidence.filter((item, idx, arr) =>
    arr.findIndex((e) => e.publisher === item.publisher) === idx
  );

  const previewCount = 2;
  const hasMore = deduped.length > previewCount;
  const visibleItems = expanded ? deduped : deduped.slice(0, previewCount);

  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
        {l.sources} ({deduped.length})
      </div>
      <div className="divide-y divide-border/15">
        {visibleItems.map((item, i) => (
          <EvidenceRow key={`${item.url}-${i}`} item={item} region={region} />
        ))}
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent-info/70 hover:text-accent-info transition-colors"
        >
          +{deduped.length - previewCount} {l.more}
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
      {expanded && hasMore && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent-info/70 hover:text-accent-info transition-colors"
        >
          {l.showLess}
        </button>
      )}
      {isInvestigation && (
        <p className="mt-2 text-[9px] italic text-muted-foreground/50 leading-relaxed">
          {region === 'turkey'
            ? 'Kamuya acik bilgilere dayanmaktadir. Ucretli icerige erisim saglanmamistir.'
            : 'Based on publicly available information. Original paywalled content was not accessed.'}
        </p>
      )}
      <p className="mt-2 text-[9px] text-muted-foreground/40 leading-relaxed">
        {l.note}
      </p>
    </div>
  );
}

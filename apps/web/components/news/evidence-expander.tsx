'use client';

import { useState } from 'react';
import { ChevronDown, Lock, ExternalLink } from 'lucide-react';
import type { EvidenceItem } from '@startup-intelligence/shared';
import { timeAgo } from '@/lib/news-utils';

interface EvidenceExpanderProps {
  evidence: EvidenceItem[];
  defaultCollapsed?: boolean;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <span className="font-medium text-foreground/80 truncate max-w-[120px]">
        {item.publisher}
      </span>
      {item.published_at && (
        <>
          <span className="text-muted-foreground/40">&middot;</span>
          <span className="text-muted-foreground/60 tabular-nums whitespace-nowrap">
            {timeAgo(item.published_at)}
          </span>
        </>
      )}
      {item.paywalled && (
        <Lock className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
      )}
      {item.url && (
        <a
          href={item.url}
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

export function EvidenceExpander({ evidence, defaultCollapsed = true }: EvidenceExpanderProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  if (!evidence || evidence.length === 0) return null;

  const previewCount = 2;
  const hasMore = evidence.length > previewCount;
  const visibleItems = expanded ? evidence : evidence.slice(0, previewCount);

  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
        Sources ({evidence.length})
      </div>
      <div className="divide-y divide-border/15">
        {visibleItems.map((item, i) => (
          <EvidenceRow key={`${item.url}-${i}`} item={item} />
        ))}
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent-info/70 hover:text-accent-info transition-colors"
        >
          +{evidence.length - previewCount} more
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
      {expanded && hasMore && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-accent-info/70 hover:text-accent-info transition-colors"
        >
          Show less
        </button>
      )}
      <p className="mt-2 text-[9px] text-muted-foreground/40 leading-relaxed">
        BuildAtlas paraphrases and cites sources. Read originals for full context.
      </p>
    </div>
  );
}

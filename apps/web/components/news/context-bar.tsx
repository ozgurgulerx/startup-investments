'use client';

import Link from 'next/link';
import type { NewsItemCard } from '@startup-intelligence/shared';

interface ContextBarProps {
  item: NewsItemCard;
  region?: 'global' | 'turkey';
}

export function ContextBar({ item, region = 'global' }: ContextBarProps) {
  const l = region === 'turkey'
    ? {
      companyDossier: 'Sirket dosyasi',
      searchDossiers: 'Dosyalarda ara',
      related: 'Ilgili',
    }
    : {
      companyDossier: 'Company dossier',
      searchDossiers: 'Search dossiers',
      related: 'Related',
    };
  const slug = item.primary_company_slug;
  const firstEntity = item.entity_links?.[0]?.entity_name || item.entities?.[0];
  const firstTopic = item.topic_tags?.[0];

  // Nothing to link to
  if (!slug && !firstEntity) return null;

  const regionParam = region === 'turkey' ? '?region=turkey' : '';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
      {slug ? (
        <Link
          href={`/company/${encodeURIComponent(slug)}${regionParam}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-accent-info transition-colors"
        >
          {l.companyDossier} &rarr;
        </Link>
      ) : firstEntity ? (
        <Link
          href={`/dealbook?search=${encodeURIComponent(firstEntity)}${region === 'turkey' ? '&region=turkey' : ''}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-accent-info transition-colors"
        >
          {l.searchDossiers} &rarr;
        </Link>
      ) : null}

      {firstTopic && (
        <Link
          href={`/topics/${encodeURIComponent(firstTopic)}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-accent-info transition-colors"
        >
          {l.related}: {firstTopic} &rarr;
        </Link>
      )}
    </div>
  );
}

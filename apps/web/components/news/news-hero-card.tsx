'use client';

import type { NewsItemCard } from '@startup-intelligence/shared';
import { NewsCard } from './news-card';

interface NewsHeroCardProps {
  item: NewsItemCard;
}

export function NewsHeroCard({ item }: NewsHeroCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-accent-info/30 bg-gradient-to-br from-accent-info/15 via-card/80 to-card/50 p-[1px]">
      <div className="relative rounded-2xl bg-background/85 p-0">
        <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-accent-info/20 blur-3xl" />
        <NewsCard item={item} featured className="rounded-2xl" />
      </div>
    </div>
  );
}

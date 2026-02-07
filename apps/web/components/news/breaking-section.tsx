import type { NewsItemCard } from '@startup-intelligence/shared';
import { NewsCard } from './news-card';
import { SectionHeader } from './section-header';

interface BreakingSectionProps {
  items: NewsItemCard[];
}

export function BreakingSection({ items }: BreakingSectionProps) {
  if (!items.length) return null;

  return (
    <div>
      <SectionHeader label="Breaking" count={items.length} indicator="pulse" />
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

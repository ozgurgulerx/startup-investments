'use client';

import { useState } from 'react';
import type { NewsItemCard } from '@startup-intelligence/shared';
import { NewsCard } from './news-card';

interface TopicTabSectionProps {
  byTopic: Record<string, NewsItemCard[]>;
  topicOrder: string[];
}

export function TopicTabSection({ byTopic, topicOrder }: TopicTabSectionProps) {
  const [activeTab, setActiveTab] = useState(topicOrder[0] || '');

  if (!topicOrder.length) return null;

  const items = byTopic[activeTab] || [];

  return (
    <div>
      <div className="mt-4 overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          {topicOrder.map((topic) => {
            const isActive = activeTab === topic;
            const count = byTopic[topic]?.length || 0;
            return (
              <button
                key={topic}
                type="button"
                onClick={() => setActiveTab(topic)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${
                  isActive
                    ? 'border-accent-info/55 bg-accent-info/15 text-accent-info'
                    : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent-info/35 hover:text-foreground'
                }`}
              >
                <span>{topic}</span>
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

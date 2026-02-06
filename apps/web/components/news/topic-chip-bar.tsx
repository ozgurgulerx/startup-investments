'use client';

import Link from 'next/link';
import type { NewsTopicStat } from '@startup-intelligence/shared';

interface TopicChipBarProps {
  topics: NewsTopicStat[];
  activeTopic?: string;
}

export function TopicChipBar({ topics, activeTopic }: TopicChipBarProps) {
  if (!topics.length) return null;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-2">
        {topics.map((topic) => {
          const isActive = activeTopic?.toLowerCase() === topic.topic.toLowerCase();
          return (
            <Link
              key={topic.topic}
              href={`/topics/${encodeURIComponent(topic.topic)}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider transition-colors ${isActive ? 'border-accent/55 bg-accent/15 text-accent' : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent/35 hover:text-foreground'}`}
            >
              <span>{topic.topic}</span>
              <span className="tabular-nums opacity-70">{topic.count}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { Bell, TrendingUp, Tag, Globe, ChevronRight } from 'lucide-react';
import type { SignalEvent } from '@/lib/data/signals';

export interface WatchlistChangesProps {
  events: SignalEvent[];
  className?: string;
}

const eventIcons: Record<SignalEvent['type'], React.ComponentType<{ className?: string }>> = {
  funding: TrendingUp,
  pattern: Tag,
  website: Globe,
  news: Bell,
  trend: TrendingUp,
};

const eventColors: Record<SignalEvent['type'], string> = {
  funding: 'text-success',
  pattern: 'text-accent',
  website: 'text-muted-foreground',
  news: 'text-foreground',
  trend: 'text-accent',
};

export function WatchlistChanges({ events, className }: WatchlistChangesProps) {
  if (events.length === 0) {
    return (
      <div className={cn('p-6 border border-border/30 rounded-lg bg-muted/5', className)}>
        <div className="flex items-center gap-3 mb-3">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">What Changed</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          No recent changes for your tracked companies. Check back later or add more companies to your watchlist.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('border border-border/30 rounded-lg overflow-hidden', className)}>
      <div className="px-4 py-3 bg-muted/10 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium text-foreground">What Changed</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {events.length} update{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="divide-y divide-border/30">
        {events.slice(0, 10).map((event, i) => (
          <EventRow key={event.id || i} event={event} />
        ))}
      </div>

      {events.length > 10 && (
        <div className="px-4 py-3 bg-muted/5 border-t border-border/30 text-center">
          <span className="text-xs text-muted-foreground">
            +{events.length - 10} more updates
          </span>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: SignalEvent }) {
  const Icon = eventIcons[event.type] || Bell;
  const iconColor = eventColors[event.type] || 'text-muted-foreground';

  const content = (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        'transition-colors duration-150',
        event.companySlug && 'hover:bg-muted/20 cursor-pointer'
      )}
    >
      <div className={cn('mt-0.5', iconColor)}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {event.title}
          </span>
          {event.importance === 'high' && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded">
              Important
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {event.description}
        </p>
        <p className="text-[10px] text-muted-foreground/50 mt-1">
          {formatRelativeTime(event.createdAt)}
        </p>
      </div>

      {event.companySlug && (
        <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0 mt-1" />
      )}
    </div>
  );

  if (event.companySlug) {
    return <Link href={`/company/${event.companySlug}`}>{content}</Link>;
  }

  return content;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

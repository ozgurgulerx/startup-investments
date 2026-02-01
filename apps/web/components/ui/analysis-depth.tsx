'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Quote, Calendar, Link } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnalysisDepthProps {
  contentBytes?: number;
  quoteCount?: number;
  analyzedAt?: string;
  sources?: string[];
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AnalysisDepth({
  contentBytes,
  quoteCount,
  analyzedAt,
  sources,
  className,
}: AnalysisDepthProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasData = contentBytes || quoteCount || analyzedAt;
  const hasSources = sources && sources.length > 0;

  if (!hasData) return null;

  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 bg-muted/10',
        className
      )}
    >
      {/* Summary row */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {contentBytes && (
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>{formatBytes(contentBytes)} analyzed</span>
            </span>
          )}
          {quoteCount !== undefined && quoteCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Quote className="h-3.5 w-3.5" />
              <span>{quoteCount} quotes</span>
            </span>
          )}
          {analyzedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Updated {formatDate(analyzedAt)}</span>
            </span>
          )}
        </div>

        {hasSources && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={isExpanded}
          >
            <span>{isExpanded ? 'Hide' : 'View'} sources</span>
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Expandable sources panel */}
      {isExpanded && hasSources && (
        <div className="border-t border-border/40 px-4 py-3">
          <div className="text-xs text-muted-foreground mb-2">Sources analyzed:</div>
          <ul className="space-y-1.5">
            {sources!.slice(0, 10).map((source, index) => (
              <li key={index} className="flex items-center gap-2 text-sm">
                <Link className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground truncate transition-colors"
                >
                  {source.replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/')}
                </a>
              </li>
            ))}
            {sources!.length > 10 && (
              <li className="text-xs text-muted-foreground/60">
                +{sources!.length - 10} more sources
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version for smaller spaces
 */
export function AnalysisDepthInline({
  contentBytes,
  quoteCount,
  analyzedAt,
  className,
}: Omit<AnalysisDepthProps, 'sources'>) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 text-xs text-muted-foreground',
        className
      )}
    >
      {contentBytes && <span>{formatBytes(contentBytes)} analyzed</span>}
      {quoteCount !== undefined && quoteCount > 0 && (
        <span>{quoteCount} quotes</span>
      )}
      {analyzedAt && <span>Updated {formatDate(analyzedAt)}</span>}
    </div>
  );
}

'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { ExternalLink, FileText } from 'lucide-react';
import Link from 'next/link';

export interface EvidenceSource {
  type: 'company' | 'article' | 'data';
  title: string;
  url?: string;
  slug?: string;
  quote?: string;
}

export interface EvidencePopoverProps {
  sources: EvidenceSource[];
  children: React.ReactNode;
  className?: string;
}

export function EvidencePopover({
  sources,
  children,
  className,
}: EvidencePopoverProps) {
  if (sources.length === 0) {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn('cursor-help border-b border-dotted border-muted-foreground/40', className)}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            align="start"
            sideOffset={8}
            className={cn(
              'z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-lg',
              'animate-in fade-in-0 zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
            )}
          >
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Evidence ({sources.length})
              </p>
              <ul className="space-y-2">
                {sources.slice(0, 4).map((source, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex items-start gap-2">
                      {source.type === 'company' ? (
                        <FileText className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      ) : (
                        <ExternalLink className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        {source.slug ? (
                          <Link
                            href={`/company/${source.slug}`}
                            className="text-foreground hover:text-accent transition-colors font-medium"
                          >
                            {source.title}
                          </Link>
                        ) : source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground hover:text-accent transition-colors font-medium"
                          >
                            {source.title}
                          </a>
                        ) : (
                          <span className="text-foreground font-medium">
                            {source.title}
                          </span>
                        )}
                        {source.quote && (
                          <p className="text-muted-foreground/70 mt-0.5 line-clamp-2">
                            "{source.quote}"
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {sources.length > 4 && (
                <p className="text-xs text-muted-foreground/60">
                  +{sources.length - 4} more sources
                </p>
              )}
            </div>
            <TooltipPrimitive.Arrow className="fill-border" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

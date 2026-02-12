'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Sheet, SheetHeader, SheetContent } from '@/components/ui/sheet';
import { timeAgo } from '@/lib/news-utils';
import type { SignalEvidence } from './signal-inspector';

const EVIDENCE_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  news: { bg: 'bg-accent-info/10', text: 'text-accent-info' },
  cluster: { bg: 'bg-foreground/10', text: 'text-foreground' },
  crawl_diff: { bg: 'bg-accent/10', text: 'text-accent' },
  manual: { bg: 'bg-muted/30', text: 'text-muted-foreground' },
};

interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signalId: string;
  signalClaim: string;
}

export function EvidenceDrawer({ open, onOpenChange, signalId, signalClaim }: EvidenceDrawerProps) {
  const [evidence, setEvidence] = useState<SignalEvidence[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/signals/${signalId}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.evidence) {
          setEvidence(data.evidence);
        }
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, signalId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="right" className="w-[380px] max-w-[90vw]">
      <SheetHeader onClose={() => onOpenChange(false)}>
        <span className="text-sm">Evidence</span>
      </SheetHeader>
      <SheetContent>
        <p className="text-xs text-muted-foreground mb-4 line-clamp-2">
          {signalClaim}
        </p>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-3 border border-border/20 rounded-lg">
                <div className="h-3 w-16 bg-muted/30 rounded mb-2" />
                <div className="h-3 w-full bg-muted/30 rounded mb-1" />
                <div className="h-3 w-3/4 bg-muted/30 rounded" />
              </div>
            ))}
          </div>
        ) : evidence.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 text-center py-8">
            No evidence items found
          </p>
        ) : (
          <div className="space-y-2">
            {evidence.slice(0, 10).map(ev => {
              const typeStyle = EVIDENCE_TYPE_STYLES[ev.evidence_type] || EVIDENCE_TYPE_STYLES.manual;
              return (
                <div key={ev.id} className="p-3 border border-border/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${typeStyle.bg} ${typeStyle.text}`}>
                      {ev.evidence_type}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {timeAgo(ev.created_at)}
                    </span>
                    {ev.startup_slug && (
                      <Link
                        href={`/company/${ev.startup_slug}`}
                        className="text-[10px] text-accent-info hover:text-accent-info/80 ml-auto flex items-center gap-0.5"
                      >
                        {ev.startup_name}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Link>
                    )}
                  </div>
                  {ev.snippet && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {ev.snippet}
                    </p>
                  )}
                  {!ev.snippet && ev.cluster_title && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {ev.cluster_title}
                    </p>
                  )}
                </div>
              );
            })}
            {evidence.length > 10 && (
              <p className="text-[10px] text-muted-foreground/50 text-center pt-2">
                Showing 10 of {evidence.length} evidence items
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

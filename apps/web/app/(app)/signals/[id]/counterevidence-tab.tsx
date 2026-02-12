'use client';

import { AlertTriangle, ShieldOff, Eye } from 'lucide-react';
import type { DeepDiveContent } from '@/lib/api/client';

interface CounterevienceTabProps {
  content: DeepDiveContent;
}

export function CounterevienceTab({ content }: CounterevienceTabProps) {
  const failureModes = content.failure_modes || [];

  if (failureModes.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No failure modes identified.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="p-4 border border-border/30 rounded-lg bg-card">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground/60">
            These are potential failure modes, vanity metrics, and counter-signals
            identified from the evidence pool. Use them to stress-test your thesis.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {failureModes.map((mode, i) => (
          <div
            key={i}
            className="p-4 border border-border/20 rounded-lg hover:border-border/40 transition-colors"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-destructive/60 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {mode.mode}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {mode.description}
                </p>
                {mode.example && (
                  <div className="mt-2 pl-3 border-l-2 border-border/30">
                    <p className="text-xs text-muted-foreground/70 italic">
                      {mode.example}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Thresholds that might indicate false signal */}
      {content.thresholds && content.thresholds.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldOff className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
              Warning Thresholds
            </h3>
          </div>
          <div className="space-y-2">
            {content.thresholds.map((t, i) => (
              <div
                key={i}
                className="flex items-start gap-3 text-xs"
              >
                <span className="text-muted-foreground/40 mt-0.5">-</span>
                <div>
                  <span className="font-medium text-foreground">{t.metric}</span>
                  {' '}
                  <span className="text-accent-info font-mono">{t.value}</span>
                  {' '}
                  <span className="text-muted-foreground">{t.action}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

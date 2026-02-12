'use client';

import { AlertTriangle, Target, Gauge, Lightbulb } from 'lucide-react';
import type { SignalItem, DeepDiveContent } from '@/lib/api/client';

interface HowItWorksTabProps {
  content: DeepDiveContent;
  signal: SignalItem;
}

export function HowItWorksTab({ content, signal }: HowItWorksTabProps) {
  return (
    <div className="space-y-8 max-w-3xl">
      {/* Mechanism */}
      {content.mechanism && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
              What This Signal Measures
            </h3>
          </div>
          <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
            {content.mechanism}
          </div>
        </section>
      )}

      {/* Definition from signal explain */}
      {signal.explain?.why && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
              Why It Matters
            </h3>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">
            {signal.explain.why}
          </p>
        </section>
      )}

      {/* Thresholds */}
      {content.thresholds && content.thresholds.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
              Action Thresholds
            </h3>
          </div>
          <div className="space-y-2">
            {content.thresholds.map((threshold, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 border border-border/20 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {threshold.metric}
                    </span>
                    <span className="text-xs text-accent-info font-mono">
                      {threshold.value}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {threshold.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Archetypes */}
      {content.patterns && content.patterns.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
            Archetypes
          </h3>
          <div className="space-y-3">
            {content.patterns.map((pattern, i) => (
              <div
                key={i}
                className="p-4 border border-border/20 rounded-lg"
              >
                <p className="text-sm font-medium text-foreground">
                  {pattern.archetype}
                </p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  {pattern.description}
                </p>
                {pattern.startups.length > 0 && (
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {pattern.startups.map((slug) => (
                      <a
                        key={slug}
                        href={`/company/${slug}`}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {slug}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Risk from signal explain */}
      {signal.explain?.risk && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60 font-medium">
              Risk
            </h3>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">
            {signal.explain.risk}
          </p>
          {signal.explain.time_horizon && (
            <p className="text-xs text-muted-foreground">
              Time horizon: {signal.explain.time_horizon}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

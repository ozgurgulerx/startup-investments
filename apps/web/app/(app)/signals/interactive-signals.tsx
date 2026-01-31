'use client';

import { useState, useCallback } from 'react';
import { Users, ArrowRight, Lightbulb } from 'lucide-react';
import { PatternCohortTable } from '@/components/features/pattern-cohort-table';
import { CoOccurrenceMatrix } from '@/components/charts/co-occurrence-matrix';
import type { PatternData } from './page';
import type { PatternCorrelation } from '@/lib/data/signals';
import type { StartupAnalysis } from '@startup-intelligence/shared';

interface InteractiveSignalsProps {
  patterns: PatternData[];
  correlations: PatternCorrelation[];
  totalDeals: number;
}

export function InteractiveSignals({
  patterns,
  correlations,
  totalDeals,
}: InteractiveSignalsProps) {
  const [cohortModal, setCohortModal] = useState<{
    isOpen: boolean;
    patternName: string;
    companies: StartupAnalysis[];
  }>({
    isOpen: false,
    patternName: '',
    companies: [],
  });

  const openCohort = useCallback((pattern: PatternData) => {
    setCohortModal({
      isOpen: true,
      patternName: pattern.name,
      companies: pattern.companies,
    });
  }, []);

  const closeCohort = useCallback(() => {
    setCohortModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  const handleMatrixCellClick = useCallback(
    (patternA: string, patternB: string) => {
      // Find companies that have both patterns
      const patternDataA = patterns.find(p => p.name === patternA);
      const companySlugsA = new Set(
        patternDataA?.companies.map(c => c.company_slug) || []
      );

      const patternDataB = patterns.find(p => p.name === patternB);
      const bothPatterns = patternDataB?.companies.filter(c =>
        companySlugsA.has(c.company_slug)
      ) || [];

      setCohortModal({
        isOpen: true,
        patternName: `${patternA} + ${patternB}`,
        companies: bothPatterns,
      });
    },
    [patterns]
  );

  const patternNames = patterns.map(p => p.name);

  return (
    <>
      {/* Page Header */}
      <header className="briefing-header">
        <span className="briefing-date">Signals</span>
        <h1 className="briefing-headline">
          Architectural patterns shaping the next generation of AI infrastructure
        </h1>
        <p className="briefing-subhead">
          Analysis of {totalDeals} deals reveals conviction levels across{' '}
          {patterns.length} distinct build patterns.
        </p>
      </header>

      {/* Patterns List */}
      <div className="space-y-0">
        {patterns.slice(0, 8).map(pattern => (
          <div key={pattern.name} className="signal-item">
            {/* Header */}
            <div className="signal-header">
              <h3 className="signal-name">{pattern.name}</h3>
              <div className="signal-conviction">
                <span className={`signal-conviction-dot ${pattern.conviction}`} />
                <span className="text-muted-foreground capitalize">
                  {pattern.conviction}
                </span>
              </div>
            </div>

            {/* Thesis */}
            <p className="signal-thesis">{pattern.thesis}</p>

            {/* What This Enables */}
            <div className="intel-callout">
              <span className="intel-callout-label">What This Enables</span>
              <p className="intel-callout-text">{pattern.enables}</p>
            </div>

            {/* Meta */}
            <div className="signal-meta mt-6">
              <div className="signal-meta-item">
                <span className="signal-meta-label">Time Horizon</span>
                <span className="signal-meta-value">{pattern.horizon}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Primary Risk</span>
                <span className="signal-meta-value max-w-xs">{pattern.risk}</span>
              </div>
              <div className="signal-meta-item">
                <span className="signal-meta-label">Companies</span>
                <span className="signal-meta-value">{pattern.count}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border/20">
              <button
                onClick={() => openCohort(pattern)}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Users className="w-3.5 h-3.5" />
                View {pattern.count} companies
                <ArrowRight className="w-3 h-3" />
              </button>

              {pattern.companies.length > 0 && (
                <span className="text-xs text-muted-foreground/60">
                  Top: {pattern.companies
                    .slice(0, 3)
                    .map(c => c.company_name)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Co-occurrence Matrix */}
      <section className="section mt-12">
        <div className="section-header">
          <span className="section-title">Pattern Relationships</span>
        </div>
        <CoOccurrenceMatrix
          correlations={correlations}
          patterns={patternNames}
          onCellClick={handleMatrixCellClick}
        />

        {/* Matrix insight */}
        <div className="mt-4 p-4 border border-border/30 rounded-lg bg-muted/10">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-foreground font-medium mb-1">Pattern Insight</p>
              <p className="text-xs text-muted-foreground">
                {getTopCorrelationInsight(correlations)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pattern Cohort Modal */}
      <PatternCohortTable
        isOpen={cohortModal.isOpen}
        onClose={closeCohort}
        patternName={cohortModal.patternName}
        companies={cohortModal.companies}
      />
    </>
  );
}

function getTopCorrelationInsight(correlations: PatternCorrelation[]): string {
  if (correlations.length === 0) {
    return 'Not enough pattern data to compute correlations.';
  }

  const top = correlations[0];
  const percentage = (top.correlation * 100).toFixed(0);

  return `${top.patternA} and ${top.patternB} appear together in ${top.coOccurrenceCount} companies (${percentage}% correlation). This suggests these patterns may complement each other in production AI systems.`;
}

'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Users, ArrowRight, Lightbulb, ExternalLink, Sparkles, TrendingUp } from 'lucide-react';
import { PatternCohortTable } from '@/components/features/pattern-cohort-table';
import { CoOccurrenceMatrix } from '@/components/charts/co-occurrence-matrix';
import type { PatternData, EmergingPattern, CategoryData } from './page';
import type { PatternCorrelation } from '@/lib/data/signals';
import type { StartupAnalysis } from '@startup-intelligence/shared';

interface InteractiveSignalsProps {
  patterns: PatternData[];
  correlations: PatternCorrelation[];
  totalDeals: number;
  emergingPatterns?: EmergingPattern[];
  categories?: CategoryData[];
}

export function InteractiveSignals({
  patterns,
  correlations,
  totalDeals,
  emergingPatterns = [],
  categories = [],
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

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Filter patterns by selected category
  const filteredPatterns = useMemo(() => {
    if (!selectedCategory) return patterns;
    // For legacy patterns, we don't have category data, so show all when filtered
    return patterns;
  }, [patterns, selectedCategory]);

  const filteredEmergingPatterns = useMemo(() => {
    if (!selectedCategory) return emergingPatterns;
    return emergingPatterns.filter(p => p.category === selectedCategory);
  }, [emergingPatterns, selectedCategory]);

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
          {emergingPatterns.length > 0 && (
            <span className="text-accent-info"> {emergingPatterns.length} emerging patterns discovered.</span>
          )}
        </p>
      </header>

      {/* Category Tabs */}
      {categories.length > 0 && (
        <div className="mb-8">
          <div className="flex flex-wrap gap-2 pb-4 border-b border-border/30">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                selectedCategory === null
                  ? 'bg-foreground text-background'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              All Patterns
            </button>
            {categories.slice(0, 8).map(cat => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                  selectedCategory === cat.name
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {cat.name}
                <span className="ml-1 opacity-60">({cat.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Emerging Patterns Section */}
      {filteredEmergingPatterns.length > 0 && (
        <section className="section mb-8">
          <div className="section-header">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent-info" />
              <span className="section-title">Emerging Patterns</span>
            </div>
            <span className="text-xs text-muted-foreground">
              High-novelty approaches discovered this period
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredEmergingPatterns.slice(0, 6).map((pattern, index) => (
              <div
                key={index}
                className="p-4 border border-border/30 rounded-lg hover:border-accent-info/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">{pattern.name}</h4>
                    <span className="text-xs text-muted-foreground">{pattern.category}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-accent-info" />
                    <span className="text-xs px-1.5 py-0.5 bg-accent-info/10 text-accent-info rounded">
                      {pattern.avgNovelty.toFixed(1)}/10
                    </span>
                  </div>
                </div>

                {pattern.whyNotable && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {pattern.whyNotable}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {pattern.count} {pattern.count === 1 ? 'company' : 'companies'}
                  </span>
                  <button
                    onClick={() => setCohortModal({
                      isOpen: true,
                      patternName: pattern.name,
                      companies: pattern.companies,
                    })}
                    className="text-xs text-accent-info hover:text-accent-info/80 transition-colors"
                  >
                    View companies →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Patterns List */}
      <div className="space-y-0">
        {filteredPatterns.slice(0, 8).map(pattern => (
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

              <Link
                href={`/dealbook?pattern=${encodeURIComponent(pattern.name)}`}
                className="inline-flex items-center gap-2 text-xs text-accent-info hover:text-accent-info/80 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Browse in Dealbook
              </Link>

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
            <Lightbulb className="w-4 h-4 text-accent-info mt-0.5 flex-shrink-0" />
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

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PatternCorrelation } from '@/lib/data/signals';

export interface CoOccurrenceMatrixProps {
  correlations: PatternCorrelation[];
  patterns: string[];
  onCellClick?: (patternA: string, patternB: string) => void;
  className?: string;
}

export function CoOccurrenceMatrix({
  correlations,
  patterns,
  onCellClick,
  className,
}: CoOccurrenceMatrixProps) {
  // Build a lookup map for correlations
  const correlationMap = React.useMemo(() => {
    const map = new Map<string, PatternCorrelation>();
    for (const c of correlations) {
      map.set(`${c.patternA}|${c.patternB}`, c);
      map.set(`${c.patternB}|${c.patternA}`, c);
    }
    return map;
  }, [correlations]);

  // Limit to top 6 patterns by count
  const topPatterns = patterns.slice(0, 6);

  if (topPatterns.length < 2) {
    return null;
  }

  return (
    <div className={cn('border border-border/30 rounded-lg overflow-hidden', className)}>
      <div className="px-4 py-3 bg-muted/10 border-b border-border/30">
        <h3 className="text-sm font-medium text-foreground">Pattern Co-occurrence</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          How often patterns appear together
        </p>
      </div>

      <div className="p-4 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="w-32" />
              {topPatterns.map(p => (
                <th
                  key={p}
                  className="text-[10px] text-muted-foreground font-normal px-1 py-2 text-center"
                  style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
                >
                  <span className="truncate max-w-[100px] block">
                    {truncatePattern(p)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topPatterns.map((rowPattern, rowIdx) => (
              <tr key={rowPattern}>
                <td className="text-xs text-muted-foreground pr-2 py-1 truncate max-w-[120px]">
                  {truncatePattern(rowPattern)}
                </td>
                {topPatterns.map((colPattern, colIdx) => {
                  // Diagonal = self
                  if (rowIdx === colIdx) {
                    return (
                      <td key={colPattern} className="p-0.5">
                        <div className="w-8 h-8 bg-muted/40 rounded" />
                      </td>
                    );
                  }

                  // Only show upper triangle
                  if (rowIdx > colIdx) {
                    return (
                      <td key={colPattern} className="p-0.5">
                        <div className="w-8 h-8" />
                      </td>
                    );
                  }

                  const key = `${rowPattern}|${colPattern}`;
                  const correlation = correlationMap.get(key);

                  return (
                    <td key={colPattern} className="p-0.5">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onCellClick?.(rowPattern, colPattern)}
                              className={cn(
                                'w-8 h-8 rounded transition-all duration-150',
                                'hover:ring-2 hover:ring-accent-info/50',
                                getCellColor(correlation?.correlation || 0)
                              )}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <p className="font-medium">
                                {truncatePattern(rowPattern)} + {truncatePattern(colPattern)}
                              </p>
                              {correlation ? (
                                <>
                                  <p className="text-muted-foreground">
                                    {correlation.coOccurrenceCount} companies
                                  </p>
                                  <p className="text-muted-foreground">
                                    Jaccard: {(correlation.correlation * 100).toFixed(0)}%
                                  </p>
                                </>
                              ) : (
                                <p className="text-muted-foreground">No co-occurrence</p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-border/30 flex items-center gap-4">
        <span className="text-xs text-muted-foreground">Correlation:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-muted/30" />
          <span className="text-xs text-muted-foreground">Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-accent-info/30" />
          <span className="text-xs text-muted-foreground">Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-accent-info/60" />
          <span className="text-xs text-muted-foreground">High</span>
        </div>
      </div>
    </div>
  );
}

function getCellColor(correlation: number): string {
  if (correlation >= 0.3) return 'bg-accent-info/60';
  if (correlation >= 0.15) return 'bg-accent-info/40';
  if (correlation >= 0.05) return 'bg-accent-info/20';
  if (correlation > 0) return 'bg-muted/50';
  return 'bg-muted/20';
}

function truncatePattern(pattern: string): string {
  // Shorten common patterns
  const replacements: Record<string, string> = {
    'RAG (Retrieval-Augmented Generation)': 'RAG',
    'Continuous-learning Flywheels': 'Continuous Learn',
    'Agentic Architectures': 'Agentic',
    'Vertical Data Moats': 'Data Moats',
    'Micro-model Meshes': 'Micro-models',
    'Natural-Language-to-Code': 'NL-to-Code',
    'Guardrail-as-LLM': 'Guardrails',
    'Knowledge Graphs': 'Knowledge Graph',
  };

  return replacements[pattern] || (pattern.length > 12 ? pattern.slice(0, 12) + '...' : pattern);
}

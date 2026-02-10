'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { MapPin, ExternalLink } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import { formatCurrency, getPatternColor, getStageColor, cn } from '@/lib/utils';
import type { StartupAnalysis } from '@startup-intelligence/shared';

interface StartupCardProps {
  startup: StartupAnalysis;
  className?: string;
  index?: number;
}

export function StartupCard({ startup, className, index = 0 }: StartupCardProps) {
  const topPatterns = startup.build_patterns
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return (
    <Link href={`/startups/${startup.company_slug}`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.05 }}
        whileHover={{ y: -4, scale: 1.01 }}
        className="h-full"
      >
        <Card
          className={cn(
            'cursor-pointer p-5 h-full transition-all duration-200 hover:border-accent-info/35 hover:-translate-y-0.5',
            className
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-semibold">
                  {startup.company_name}
                </h3>
                {startup.website && (
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                {startup.location && (
                  <>
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="truncate">{startup.location}</span>
                    <span>·</span>
                  </>
                )}
                <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', getStageColor(startup.funding_stage || 'unknown'))}>
                  {(startup.funding_stage || 'unknown').replace(/_/g, ' ')}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-light tabular-nums bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {formatCurrency(startup.funding_amount || 0, true)}
              </p>
            </div>
          </div>

          {/* Patterns */}
          {topPatterns.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {topPatterns.map((pattern, i) => (
                <motion.div
                  key={pattern.name}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 + 0.1 + i * 0.05 }}
                >
                  <Badge
                    variant="outline"
                    className={cn('text-xs', getPatternColor(pattern.name))}
                  >
                    {pattern.name.replace('(Retrieval-Augmented Generation)', '')}
                  </Badge>
                </motion.div>
              ))}
            </div>
          )}

          {/* Description */}
          {startup.description && (
            <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
              {startup.description}
            </p>
          )}

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              {startup.uses_genai && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  GenAI
                  {startup.genai_intensity && (
                    <span className="text-success capitalize">· {startup.genai_intensity}</span>
                  )}
                </span>
              )}
            </div>
            <span className="capitalize">{(startup.vertical || 'other').replace(/_/g, ' ')}</span>
          </div>
        </Card>
      </motion.div>
    </Link>
  );
}

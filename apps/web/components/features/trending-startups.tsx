'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Sparkles, Info } from 'lucide-react';
import { Card } from '@/components/ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TrendingStartup {
  name: string;
  slug: string;
  vertical: string;
  patterns?: string[];
  score?: number;
}

interface TrendingStartupsProps {
  data: TrendingStartup[];
  maxItems?: number;
  className?: string;
}

const verticalStyles: Record<string, string> = {
  fintech: 'bg-success/10 text-success',
  financial_services: 'bg-success/10 text-success',
  healthcare: 'bg-destructive/10 text-destructive',
  'ai/ml': 'bg-delta/10 text-delta',
  horizontal: 'bg-delta/10 text-delta',
  edtech: 'bg-accent-info/10 text-accent-info',
  education: 'bg-accent-info/10 text-accent-info',
  saas: 'bg-accent-info/10 text-accent-info',
  enterprise_saas: 'bg-accent-info/10 text-accent-info',
  ecommerce: 'bg-warning/10 text-warning',
  logistics: 'bg-warning/10 text-warning',
  industrial: 'bg-warning/10 text-warning',
  gaming: 'bg-delta/10 text-delta',
  media_content: 'bg-delta/10 text-delta',
  proptech: 'bg-success/10 text-success',
  hrtech: 'bg-accent-info/10 text-accent-info',
  hr_recruiting: 'bg-accent-info/10 text-accent-info',
  developer_tools: 'bg-accent-info/10 text-accent-info',
  cybersecurity: 'bg-destructive/10 text-destructive',
  legal: 'bg-muted/50 text-muted-foreground',
  consumer: 'bg-delta/10 text-delta',
  marketing: 'bg-success/10 text-success',
};

function formatVertical(vertical: string): string {
  const labels: Record<string, string> = {
    'ai/ml': 'AI/ML',
    horizontal: 'AI/ML',
    financial_services: 'Fintech',
    enterprise_saas: 'Enterprise',
    developer_tools: 'Dev Tools',
    hr_recruiting: 'HR Tech',
    media_content: 'Media',
  };
  return labels[vertical?.toLowerCase()] ||
    vertical?.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') ||
    'Other';
}

export function TrendingStartups({ data, maxItems = 8, className }: TrendingStartupsProps) {
  const startups = data.slice(0, maxItems);

  return (
    <Card className={cn(
      'h-full rounded-xl',
      'bg-card/50 backdrop-blur-sm',
      'border border-border/40',
      className
    )}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-help flex items-center gap-1.5 hover:text-foreground/70 transition-colors">
                    High Potential
                    <Info className="h-3 w-3 text-muted-foreground/40" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  <p className="text-[11px] leading-relaxed">
                    Startups scored on innovative build patterns, technical depth,
                    unique positioning, and story potential.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <span className="text-[10px] text-primary/60 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Trending
          </span>
        </div>

        {/* List */}
        <div className="space-y-1">
          {startups.map((startup, index) => (
            <motion.div
              key={startup.slug || startup.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03, duration: 0.2 }}
            >
              <Link
                href={`/startups/${startup.slug}`}
                className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.02] transition-colors group"
              >
                <span className="text-[11px] text-muted-foreground/50 w-5 tabular-nums">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground/90 truncate group-hover:text-primary transition-colors">
                    {startup.name}
                  </p>
                  {startup.patterns && startup.patterns.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">
                      {startup.patterns.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <span className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded shrink-0',
                  verticalStyles[startup.vertical?.toLowerCase()] || 'bg-white/5 text-muted-foreground'
                )}>
                  {formatVertical(startup.vertical)}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        {startups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No trending startups available
          </p>
        )}
      </div>
    </Card>
  );
}

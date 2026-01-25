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
  fintech: 'bg-emerald-500/10 text-emerald-400',
  financial_services: 'bg-emerald-500/10 text-emerald-400',
  healthcare: 'bg-rose-500/10 text-rose-400',
  'ai/ml': 'bg-violet-500/10 text-violet-400',
  horizontal: 'bg-violet-500/10 text-violet-400',
  edtech: 'bg-blue-500/10 text-blue-400',
  education: 'bg-blue-500/10 text-blue-400',
  saas: 'bg-cyan-500/10 text-cyan-400',
  enterprise_saas: 'bg-cyan-500/10 text-cyan-400',
  ecommerce: 'bg-amber-500/10 text-amber-400',
  logistics: 'bg-orange-500/10 text-orange-400',
  industrial: 'bg-orange-500/10 text-orange-400',
  gaming: 'bg-pink-500/10 text-pink-400',
  media_content: 'bg-pink-500/10 text-pink-400',
  proptech: 'bg-teal-500/10 text-teal-400',
  hrtech: 'bg-indigo-500/10 text-indigo-400',
  hr_recruiting: 'bg-indigo-500/10 text-indigo-400',
  developer_tools: 'bg-sky-500/10 text-sky-400',
  cybersecurity: 'bg-red-500/10 text-red-400',
  legal: 'bg-slate-500/10 text-slate-400',
  consumer: 'bg-fuchsia-500/10 text-fuchsia-400',
  marketing: 'bg-lime-500/10 text-lime-400',
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
      'border border-white/[0.04]',
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

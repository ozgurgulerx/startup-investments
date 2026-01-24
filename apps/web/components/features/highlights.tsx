'use client';

import { motion } from 'framer-motion';
import { Lightbulb, TrendingUp, Users, Globe } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { HighlightIcon, HighlightData } from './generate-highlights';

interface HighlightsProps {
  title?: string;
  highlights: HighlightData[];
  className?: string;
}

const ICON_MAP: Record<HighlightIcon, React.ReactNode> = {
  trending: <TrendingUp className="h-3 w-3" />,
  users: <Users className="h-3 w-3" />,
  globe: <Globe className="h-3 w-3" />,
  default: <TrendingUp className="h-3 w-3" />,
};

export function Highlights({
  title = 'Highlights',
  highlights,
  className,
}: HighlightsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn('glow-card border-border/50 overflow-hidden relative', className)}>
        {/* Accent bar at top */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-sky-500/60" />

        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded bg-muted/40">
              <Lightbulb className="h-3.5 w-3.5 text-primary/70" strokeWidth={1.5} />
            </div>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {title}
            </span>
          </div>
          <ul className="space-y-2.5">
            {highlights.map((highlight, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + index * 0.08, duration: 0.25 }}
                className="flex items-start gap-2.5 text-xs text-muted-foreground group"
              >
                <span className="mt-0.5 flex-shrink-0 text-primary/60 group-hover:text-primary transition-colors">
                  {ICON_MAP[highlight.icon]}
                </span>
                <span className="group-hover:text-foreground transition-colors leading-relaxed">
                  {highlight.text}
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
      </Card>
    </motion.div>
  );
}

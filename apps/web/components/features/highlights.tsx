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
  trending: <TrendingUp className="h-3.5 w-3.5" />,
  users: <Users className="h-3.5 w-3.5" />,
  globe: <Globe className="h-3.5 w-3.5" />,
  default: <TrendingUp className="h-3.5 w-3.5" />,
};

export function Highlights({
  title = 'Highlights',
  highlights,
  className,
}: HighlightsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className={cn('', className)}>
        <div className="p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <div className="p-2 rounded-lg bg-muted/50">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="font-medium text-foreground">
              {title}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {highlights.map((highlight, index) => (
              <motion.li
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + index * 0.1, duration: 0.3 }}
                className="flex items-start gap-3 text-sm text-muted-foreground group"
              >
                <span className="mt-0.5 flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
                  {ICON_MAP[highlight.icon]}
                </span>
                <span className="group-hover:text-foreground transition-colors">{highlight.text}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </Card>
    </motion.div>
  );
}

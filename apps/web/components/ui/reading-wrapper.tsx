'use client';

import { useReadingMode } from '@/lib/reading-mode-context';
import { cn } from '@/lib/utils';

export function ReadingWrapper({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { readingMode } = useReadingMode();

  return (
    <div
      className={cn(
        'transition-colors duration-300',
        readingMode === 'paper' && 'paper rounded-lg bg-background p-6 -mx-4 lg:-mx-6',
        className
      )}
    >
      {children}
    </div>
  );
}

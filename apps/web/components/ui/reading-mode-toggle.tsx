'use client';

import { useReadingMode } from '@/lib/reading-mode-context';
import { cn } from '@/lib/utils';

export function ReadingModeToggle() {
  const { readingMode, setReadingMode } = useReadingMode();

  return (
    <div className="flex items-center border border-border/40 rounded-full overflow-hidden text-xs">
      <button
        onClick={() => setReadingMode('dark')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 transition-colors',
          readingMode === 'dark'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="Dark mode"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      </button>
      <button
        onClick={() => setReadingMode('paper')}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 transition-colors',
          readingMode === 'paper'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title="Paper mode"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </button>
    </div>
  );
}

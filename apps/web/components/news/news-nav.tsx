import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/page-container';

type NavProps = {
  activeRegion?: 'global' | 'turkey';
  activePeriod?: 'daily' | 'weekly' | 'monthly';
  archiveDate?: string; // e.g. "2026-02-08" — enables archive mode with date display + "Latest" button
  rightSlot?: ReactNode; // custom right-side content (replaces default controls)
};

const activePill = 'rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info bg-accent-info/10 border border-accent-info/25';
const inactivePill = 'rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/25 transition-colors';

function regionPath(region: 'global' | 'turkey', period: 'daily' | 'weekly' | 'monthly', archiveDate?: string) {
  const base = region === 'turkey' ? '/news/turkey' : '/news';
  if (archiveDate) return `${base}/${archiveDate}`;
  if (period === 'daily') return base;
  return `${base}/${period}`;
}

function formatEditionDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function NewsNav({ activeRegion = 'global', activePeriod = 'daily', archiveDate, rightSlot }: NavProps) {
  const latestHref = activeRegion === 'turkey' ? '/news/turkey' : '/news';
  const latestLabel = activeRegion === 'turkey' ? 'Latest Turkey Edition' : 'Latest Edition';

  return (
    <nav className="sticky top-0 z-30 shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
      <PageContainer className="flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
        </Link>
        {rightSlot ? (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {rightSlot}
          </div>
        ) : (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {archiveDate && (
            <span className="hidden sm:inline text-muted-foreground">{formatEditionDate(archiveDate)}</span>
          )}

          {!archiveDate && (
            <Link href="/methodology" className="hidden sm:inline hover:text-foreground transition-colors">Methodology</Link>
          )}

          {/* Region toggle */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
            <Link href={regionPath('global', activePeriod, archiveDate)} className={activeRegion === 'global' ? activePill : inactivePill}>Global</Link>
            <Link href={regionPath('turkey', activePeriod, archiveDate)} className={activeRegion === 'turkey' ? activePill : inactivePill}>Turkey</Link>
          </div>

          {/* Period toggle */}
          {!archiveDate && (
            <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
              <Link href={regionPath(activeRegion, 'daily')} className={activePeriod === 'daily' ? activePill : inactivePill}>Daily</Link>
              <Link href={regionPath(activeRegion, 'weekly')} className={activePeriod === 'weekly' ? activePill : inactivePill}>Weekly</Link>
              <Link href={regionPath(activeRegion, 'monthly')} className={activePeriod === 'monthly' ? activePill : inactivePill}>Monthly</Link>
            </div>
          )}

          <Link
            href={activeRegion === 'turkey' ? '/news/turkey/search' : '/news/search'}
            className={inactivePill}
          >
            Search
          </Link>

          <Link
            href={activeRegion === 'turkey' ? '/news/turkey/archive' : '/news/archive'}
            className={inactivePill}
          >
            Archive
          </Link>

          {archiveDate && (
            <Link
              href={latestHref}
              className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30 transition-colors"
            >
              {latestLabel}
            </Link>
          )}
        </div>
        )}
      </PageContainer>
    </nav>
  );
}

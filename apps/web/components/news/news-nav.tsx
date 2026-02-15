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

function formatEditionDate(value: string, locale: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function NewsNav({ activeRegion = 'global', activePeriod = 'daily', archiveDate, rightSlot }: NavProps) {
  const latestHref = activeRegion === 'turkey' ? '/news/turkey' : '/news';
  const isTR = activeRegion === 'turkey';
  const locale = isTR ? 'tr-TR' : 'en-US';
  const l = isTR
    ? {
      latestLabel: 'En yeni Turkiye baskisi',
      methodology: 'Metodoloji',
      global: 'Global',
      turkey: 'Turkiye',
      daily: 'Gunluk',
      weekly: 'Haftalik',
      monthly: 'Aylik',
      search: 'Ara',
      archive: 'Arsiv',
    }
    : {
      latestLabel: 'Latest Edition',
      methodology: 'Methodology',
      global: 'Global',
      turkey: 'Turkey',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      search: 'Search',
      archive: 'Archive',
    };

  return (
    <nav className="sticky top-0 z-30 shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
      <PageContainer className="flex h-14 items-center gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
        </Link>
        <div className="flex-1 min-w-0 flex justify-start sm:justify-end overflow-x-auto scrollbar-none">
          {rightSlot ? (
            <div className="flex min-w-max items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
              {rightSlot}
            </div>
          ) : (
            <div className="flex min-w-max items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
              {archiveDate && (
                <span className="hidden sm:inline text-muted-foreground">{formatEditionDate(archiveDate, locale)}</span>
              )}

              {!archiveDate && (
                <Link href="/methodology" className="hidden sm:inline hover:text-foreground transition-colors">{l.methodology}</Link>
              )}

              {/* Region toggle */}
              <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
                <Link href={regionPath('global', activePeriod, archiveDate)} className={activeRegion === 'global' ? activePill : inactivePill}>{l.global}</Link>
                <Link href={regionPath('turkey', activePeriod, archiveDate)} className={activeRegion === 'turkey' ? activePill : inactivePill}>{l.turkey}</Link>
              </div>

              {/* Period toggle */}
              {!archiveDate && (
                <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
                  <Link href={regionPath(activeRegion, 'daily')} className={activePeriod === 'daily' ? activePill : inactivePill}>{l.daily}</Link>
                  <Link href={regionPath(activeRegion, 'weekly')} className={activePeriod === 'weekly' ? activePill : inactivePill}>{l.weekly}</Link>
                  <Link href={regionPath(activeRegion, 'monthly')} className={activePeriod === 'monthly' ? activePill : inactivePill}>{l.monthly}</Link>
                </div>
              )}

              <Link
                href={activeRegion === 'turkey' ? '/news/turkey/search' : '/news/search'}
                className={inactivePill}
              >
                {l.search}
              </Link>

              <Link
                href={activeRegion === 'turkey' ? '/news/turkey/archive' : '/news/archive'}
                className={inactivePill}
              >
                {l.archive}
              </Link>

              {archiveDate && (
                <Link
                  href={latestHref}
                  className="rounded border border-border/50 px-3 py-1.5 text-foreground hover:bg-muted/30 transition-colors"
                >
                  {l.latestLabel}
                </Link>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    </nav>
  );
}

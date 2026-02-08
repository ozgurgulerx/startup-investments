import Link from 'next/link';

type NavProps = {
  activeRegion: 'global' | 'turkey';
  activePeriod: 'daily' | 'weekly' | 'monthly';
};

const activePill = 'rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info bg-accent-info/10 border border-accent-info/25';
const inactivePill = 'rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/25 transition-colors';

function regionPath(region: 'global' | 'turkey', period: 'daily' | 'weekly' | 'monthly') {
  const base = region === 'turkey' ? '/news/turkey' : '/news';
  if (period === 'daily') return base;
  return `${base}/${period}`;
}

export function NewsNav({ activeRegion, activePeriod }: NavProps) {
  return (
    <nav className="shrink-0 border-b border-border/30 bg-background/95 backdrop-blur-sm">
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent/60 via-accent to-accent/60" />
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-base font-medium tracking-tight text-foreground">Build Atlas</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/methodology" className="hidden sm:inline hover:text-foreground transition-colors">Methodology</Link>

          {/* Region toggle */}
          <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
            <Link href={regionPath('global', activePeriod)} className={activeRegion === 'global' ? activePill : inactivePill}>Global</Link>
            <Link href={regionPath('turkey', activePeriod)} className={activeRegion === 'turkey' ? activePill : inactivePill}>Turkey</Link>
          </div>

          {/* Period toggle */}
          <div className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/15 p-0.5">
            <Link href={regionPath(activeRegion, 'daily')} className={activePeriod === 'daily' ? activePill : inactivePill}>Daily</Link>
            <Link href={regionPath(activeRegion, 'weekly')} className={activePeriod === 'weekly' ? activePill : inactivePill}>Weekly</Link>
            <Link href={regionPath(activeRegion, 'monthly')} className={activePeriod === 'monthly' ? activePill : inactivePill}>Monthly</Link>
          </div>

          <Link
            href={activeRegion === 'turkey' ? '/news/turkey/archive' : '/news/archive'}
            className="hidden sm:inline text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Archive
          </Link>
        </div>
      </div>
    </nav>
  );
}

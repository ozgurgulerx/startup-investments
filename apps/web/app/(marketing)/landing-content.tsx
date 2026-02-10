'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useAudience } from '@/lib/audience-context';
import { AudienceToggle } from '@/components/ui/audience-toggle';
import { DailyNewsModule } from '@/components/news/daily-news-module';
import { NewsNav } from '@/components/news/news-nav';
import { BrandMark } from '@/components/ui/brand-mark';
import { Search } from 'lucide-react';
import { COPY, SUPPORTING_LINE, FAQ_ITEMS, SIGN_IN_COPY, type MetricsData } from '@/lib/copy';

const HERO_PATTERN_CHIPS = [
  { label: 'Agentic Architectures', param: 'Agentic Architectures' },
  { label: 'Vertical Data Moats', param: 'Vertical Data Moats' },
  { label: 'RAG', param: 'RAG' },
];

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthIndex = parseInt(month, 10) - 1;
  return `${monthNames[monthIndex] || month} ${year}`;
}

interface LandingContentProps {
  metrics: MetricsData;
  latestPeriod: string;
}

export default function LandingContent({ metrics, latestPeriod }: LandingContentProps) {
  const { audience } = useAudience();
  const { data: session } = useSession();
  const router = useRouter();
  const copy = COPY[audience];
  const [heroSearch, setHeroSearch] = useState('');

  const periodLabel = formatPeriodLabel(latestPeriod).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <NewsNav activeRegion="global" activePeriod="daily" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-8 pb-10 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-3 mb-5">
                <AudienceToggle />
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight text-foreground mb-5 leading-tight">
                {copy.heroHeadline}
              </h1>

              <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
                {copy.heroSubhead}
              </p>

              {/* Hero Search */}
              <form
                className="mt-8 max-w-lg"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (heroSearch.trim()) {
                    router.push(`/dealbook?search=${encodeURIComponent(heroSearch.trim())}&month=all`);
                  }
                }}
              >
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={heroSearch}
                    onChange={(e) => setHeroSearch(e.target.value)}
                    placeholder={copy.heroSearchPlaceholder}
                    className="w-full pl-12 pr-4 py-3.5 text-base rounded-lg bg-card/40 border border-border/30 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent/70 focus:border-accent/70 transition-colors"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {HERO_PATTERN_CHIPS.map((chip) => (
                    <Link
                      key={chip.param}
                      href={`/dealbook?pattern=${encodeURIComponent(chip.param)}&month=all`}
                      className="inline-flex items-center px-3 py-1.5 text-xs rounded-full border border-accent-info/25 bg-accent-info/10 text-accent-info hover:bg-accent-info/20 transition-colors"
                    >
                      {chip.label}
                    </Link>
                  ))}
                </div>
              </form>

              <div className="mt-6 flex flex-col sm:flex-row items-center gap-4">
                <Link
                  href={copy.primaryCTAHref}
                  className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
                >
                  {copy.primaryCTA}
                </Link>
                {session?.user ? (
                  <Link
                    href="/watchlist"
                    className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
                  >
                    View Watchlist
                  </Link>
                ) : (
                  <Link
                    href={copy.secondaryCTAHref}
                    className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
                  >
                    {copy.secondaryCTA}
                  </Link>
                )}
              </div>
            </div>

            <div className="lg:col-span-4">
              <div className="rounded-xl border border-border/40 bg-card/60 p-4">
                <p className="label-xs text-accent-info mb-3">What You Track</p>
                <ul className="space-y-3">
                  {copy.heroBullets.slice(0, 3).map((bullet, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                      <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Daily News - primary surface */}
      <DailyNewsModule className="pt-0 pb-8" />

      {/* Stats Bar */}
      <section className="py-10 border-y border-border/30 bg-card/40">
        <div className="max-w-6xl mx-auto px-6">
          <p className="label-xs text-accent-info mb-6 text-center">{periodLabel} Snapshot</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div className="relative group">
              <p className="text-3xl font-light text-foreground tabular-nums">{metrics.companies.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{metrics.companies.shortLabel}</p>
              <p className="text-xs text-muted-foreground/60 mt-1 hidden md:block">{metrics.companies.description}</p>
            </div>
            <div className="group">
              <p className="text-3xl font-light text-accent tabular-nums">{metrics.capital.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{metrics.capital.label}</p>
              <p className="text-xs text-muted-foreground/60 mt-1 hidden md:block">{metrics.capital.description}</p>
            </div>
            <div className="group">
              <p className="text-3xl font-light text-foreground tabular-nums">{metrics.patterns.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{metrics.patterns.label}</p>
              <p className="text-xs text-muted-foreground/60 mt-1 hidden md:block">{metrics.patterns.description}</p>
            </div>
            <div className="group">
              <p className="text-3xl font-light text-foreground tabular-nums">{metrics.genai.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{metrics.genai.label}</p>
              <p className="text-xs text-muted-foreground/60 mt-1 hidden md:block">{metrics.genai.description}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Credibility strip */}
      <div className="py-3 text-center">
        <p className="text-xs text-muted-foreground/60 tracking-wide">
          {formatPeriodLabel(latestPeriod)} data &middot; {metrics.companies.value} companies tracked &middot; 50+ sources &middot; Updated daily
        </p>
      </div>

      {/* What You Get */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="headline-lg text-foreground mb-4">
              What You Get
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              {SUPPORTING_LINE}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-4 border border-border/40 rounded-xl">
              <div className="w-10 h-10 mb-4 rounded bg-accent-info/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="headline-sm text-foreground mb-2">Brief</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A concise monthly thesis on what changed, why it matters, and implications for builders and investors.
              </p>
            </div>

            <div className="p-4 border border-border/40 rounded-xl">
              <div className="w-10 h-10 mb-4 rounded bg-accent-info/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="headline-sm text-foreground mb-2">Dossiers</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Searchable company-level breakdowns with architecture, stack, positioning, and confidence-scored signals.
              </p>
            </div>

            <div className="p-4 border border-border/40 rounded-xl">
              <div className="w-10 h-10 mb-4 rounded bg-accent-info/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="headline-sm text-foreground mb-2">Signals</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Emerging build patterns detected across startups, with confidence levels and failure modes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sample Preview */}
      <section className="py-16 px-6 border-y border-border/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="headline-lg text-foreground mb-4">
              Analysis, Not Noise
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Every dossier is backed by evidence. Every signal is detected from real implementation data.
            </p>
          </div>

          {/* Mock Brief Preview */}
          <div className="max-w-3xl mx-auto p-6 bg-card/60 border border-border/40 rounded-xl relative overflow-hidden">
            {/* Accent left border */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-accent via-accent/60 to-accent/20" />
            <div className="label-xs text-accent-info mb-4">{periodLabel} BRIEF</div>
            <h3 className="text-xl font-light text-foreground mb-4 leading-relaxed">
              Agentic architectures dominate new funding, with <span className="text-accent">{metrics.genai.value}</span> of startups building
              on generative AI infrastructure and multi-model orchestration.
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              This month, {metrics.companies.value} funded AI startups raised {metrics.capital.value} across seed to Series D+. <span className="text-foreground/90">Implication:</span> the middleware layer is heating up.
            </p>
            <div className="flex gap-8 pt-4 border-t border-accent/30">
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">{metrics.companies.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metrics.companies.shortLabel}</p>
              </div>
              <div>
                <p className="text-2xl font-light text-accent tabular-nums">{metrics.capital.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metrics.capital.shortLabel}</p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">{metrics.patterns.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metrics.patterns.shortLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sign In to Personalize - only show when not logged in */}
      {!session?.user && (
        <section id="personalize" className="py-16 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-accent-info/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="headline-lg text-foreground mb-4">
              {SIGN_IN_COPY.title}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
              {SIGN_IN_COPY.body}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                {SIGN_IN_COPY.primaryCTA}
              </Link>
              <Link
                href="/brief"
                className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                {SIGN_IN_COPY.secondaryCTA}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Welcome back for logged in users */}
      {session?.user && (
        <section id="personalize" className="py-16 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-accent-info/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="headline-lg text-foreground mb-4">
              Welcome back, {session.user.name?.split(' ')[0] || 'there'}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
              Jump into your personalized experience. Your watchlist and preferences are ready.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/brief"
                className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                Go to Brief
              </Link>
              <Link
                href="/watchlist"
                className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                View Watchlist
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Methodology Teaser */}
      <section className="py-16 px-6 border-y border-border/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="headline-lg text-foreground mb-4">
            How We Decode Startups
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Build Atlas combines automated data collection from 50+ sources with
            LLM-powered architecture detection to deliver actionable startup intelligence for builders and investors.
            Every dossier includes evidence counts, confidence scores, and source attribution.
          </p>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-2 text-accent-info hover:text-accent-info/80 transition-colors"
          >
            Read our methodology
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="headline-lg text-foreground mb-10 text-center">
            Frequently Asked Questions
          </h2>

          <div className="space-y-5">
            {FAQ_ITEMS.map((item, index) => (
              <div key={index} className="pb-5 border-b border-border/30">
                <h3 className="text-sm font-medium text-foreground mb-2">{item.question}</h3>
                <p className="text-sm text-muted-foreground">{item.answer}</p>
              </div>
            ))}
            <div className="pb-5 border-b border-border/30">
              <h3 className="text-sm font-medium text-foreground mb-2">How do I report a bug or request a feature?</h3>
              <p className="text-sm text-muted-foreground">
                Email{' '}
                <a href="mailto:support@graph-atlas.com" className="text-accent-info hover:text-foreground transition-colors">
                  support@graph-atlas.com
                </a>
                {' '}or visit our{' '}
                <Link href="/support" className="text-accent-info hover:text-foreground transition-colors">
                  support page
                </Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-border/30">
	        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
	          <BrandMark size="sm" variant="muted" />
	          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
	            <Link href="/methodology" className="hover:text-accent-info transition-colors">Methodology</Link>
	            <Link href="/news" className="hover:text-accent-info transition-colors">Newsroom</Link>
	            <Link href="/brief" className="hover:text-accent-info transition-colors">Brief</Link>
	            <Link href="/dealbook" className="hover:text-accent-info transition-colors">Dossiers</Link>
	            <Link href="/terms" className="hover:text-accent-info transition-colors">Terms</Link>
	            <Link href="/privacy" className="hover:text-accent-info transition-colors">Privacy</Link>
	            <Link href="/support" className="hover:text-accent-info transition-colors">Support</Link>
	            <a href="mailto:support@graph-atlas.com" className="hover:text-accent-info transition-colors">support@graph-atlas.com</a>
	          </div>
	          <p className="text-xs text-muted-foreground/60">
	            © 2026 Build Atlas
	          </p>
	        </div>
	      </footer>
    </div>
  );
}

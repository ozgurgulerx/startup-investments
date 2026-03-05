'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search } from 'lucide-react';
import { DailyNewsModule } from '@/components/news/daily-news-module';
import { NewsNav } from '@/components/news/news-nav';
import { BrandMark } from '@/components/ui/brand-mark';
import {
  COPY,
  FAQ_ITEMS,
  ROUTE_MESSAGING,
  SIGN_IN_COPY,
  SUPPORTING_LINE,
  INVESTOR_COPY_IA_V1_ENABLED,
  type MetricsData,
} from '@/lib/copy';

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

const INVESTOR_STEPS = [
  {
    step: 'Step 1',
    title: 'Find comparable companies fast',
    body: 'Start in Dossiers to segment by stage, pattern, and market context before spending analyst cycles.',
  },
  {
    step: 'Step 2',
    title: 'Validate moat and execution claims',
    body: 'Use source-backed evidence and confidence signals to test whether a story is durable or narrative-heavy.',
  },
  {
    step: 'Step 3',
    title: 'Track momentum and underwriting risk',
    body: 'Follow Signals and Capital to catch pattern shifts that can move conviction up or down.',
  },
] as const;

const BUILDER_STEPS = [
  {
    step: 'Step 1',
    title: 'Find proven product wedges quickly',
    body: 'Start in Dossiers to compare similar companies by stage, category, and execution context before roadmap commitments.',
  },
  {
    step: 'Step 2',
    title: 'Stress-test moat and GTM assumptions',
    body: 'Use source-backed evidence and confidence signals to separate durable advantages from narrative-heavy positioning.',
  },
  {
    step: 'Step 3',
    title: 'Track pattern shifts in your market',
    body: 'Follow Signals and Capital to spot adoption and funding changes that should influence product and go-to-market bets.',
  },
] as const;

const INVESTOR_SURFACE_MAP = [
  {
    title: 'Dossiers',
    body: 'Company-level breakdowns of wedge, moat, execution, and momentum for diligence decisions.',
    href: '/dealbook',
    cta: 'Open Dossiers',
  },
  {
    title: 'Signals',
    body: 'Cross-company pattern momentum that flags where adoption and conviction are accelerating or cooling.',
    href: '/signals',
    cta: 'Open Signals',
  },
  {
    title: 'Capital',
    body: 'Funding regime context, concentration metrics, and deal flow shifts to stress-test assumptions.',
    href: '/capital',
    cta: 'Open Capital',
  },
  {
    title: 'Brief',
    body: 'Periodic synthesis of what changed, why it matters, and where thesis risk is moving.',
    href: '/brief',
    cta: 'Open Brief',
  },
] as const;

const BUILDER_SURFACE_MAP = [
  {
    title: 'Dossiers',
    body: 'Company-level breakdowns of wedge, moat, execution, and momentum to benchmark strategic choices.',
    href: '/dealbook',
    cta: 'Open Dossiers',
  },
  {
    title: 'Signals',
    body: 'Cross-company pattern momentum that shows where adoption is accelerating or stalling.',
    href: '/signals',
    cta: 'Open Signals',
  },
  {
    title: 'Capital',
    body: 'Funding context and concentration shifts to understand where market conviction is forming.',
    href: '/capital',
    cta: 'Open Capital',
  },
  {
    title: 'Brief',
    body: 'Periodic synthesis of what changed, why it matters, and what to watch next.',
    href: '/brief',
    cta: 'Open Brief',
  },
] as const;

export default function LandingContent({ metrics, latestPeriod }: LandingContentProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [heroSearch, setHeroSearch] = useState('');

  const copy = INVESTOR_COPY_IA_V1_ENABLED ? COPY.investors : COPY.builders;
  const homeMessaging = ROUTE_MESSAGING.home;
  const workflowLabel = INVESTOR_COPY_IA_V1_ENABLED ? 'Investor Workflow' : 'Builder Workflow';
  const workflowHeadline = INVESTOR_COPY_IA_V1_ENABLED
    ? 'How investors use Build Atlas'
    : 'How builders use Build Atlas';
  const workflowSteps = INVESTOR_COPY_IA_V1_ENABLED ? INVESTOR_STEPS : BUILDER_STEPS;
  const surfaceHeadline = INVESTOR_COPY_IA_V1_ENABLED
    ? 'Product surfaces mapped to investor jobs'
    : 'Product surfaces mapped to builder jobs';
  const surfaceDescription = INVESTOR_COPY_IA_V1_ENABLED
    ? 'Each surface answers a distinct decision question and links into the same evidence chain.'
    : 'Each surface supports a specific product or GTM decision with linked evidence.';
  const surfaceMap = INVESTOR_COPY_IA_V1_ENABLED ? INVESTOR_SURFACE_MAP : BUILDER_SURFACE_MAP;
  const periodLabel = formatPeriodLabel(latestPeriod).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <NewsNav
        activeRegion="global"
        activePeriod="daily"
        rightSlot={
          <>
            <Link href="/methodology" className="hidden sm:inline hover:text-foreground transition-colors">Methodology</Link>
            <Link href="/news" className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider text-accent-info bg-accent-info/10 border border-accent-info/25">
              Signal Feed
            </Link>
          </>
        }
      />

      <section className="relative overflow-hidden pt-10 pb-12 px-6 border-b border-border/20">
        <div className="max-w-6xl mx-auto">
          <p className="label-xs text-accent-info mb-4">{workflowLabel}</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight text-foreground mb-5 leading-tight max-w-5xl">
            {INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.headline : copy.heroHeadline}
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
            {INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.subhead : copy.heroSubhead}
          </p>

          <form
            className="mt-8 max-w-xl"
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
          </form>

          <div className="mt-6 flex flex-col sm:flex-row items-center gap-4">
            <Link
              href={INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.primaryAction.href : copy.primaryCTAHref}
              className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              {INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.primaryAction.label : copy.primaryCTA}
            </Link>
            <Link
              href={INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.secondaryAction.href : copy.secondaryCTAHref}
              className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
            >
              {INVESTOR_COPY_IA_V1_ENABLED ? homeMessaging.secondaryAction.label : copy.secondaryCTA}
            </Link>
          </div>
        </div>
      </section>

      <section className="py-8 px-6 border-b border-border/20 bg-card/25">
        <div className="max-w-6xl mx-auto">
          <p className="text-xs text-muted-foreground/80 tracking-wide text-center">
            {periodLabel} data · {metrics.companies.value} companies tracked · {metrics.capital.value} capital mapped · 50+ sources · Updated daily
          </p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="headline-lg text-foreground mb-4">{workflowHeadline}</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">{SUPPORTING_LINE}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {workflowSteps.map((item) => (
              <article key={item.title} className="rounded-xl border border-border/40 bg-card/40 p-5">
                <p className="label-xs text-accent-info mb-2">{item.step}</p>
                <h3 className="headline-sm text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 border-y border-border/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="headline-lg text-foreground mb-4">{surfaceHeadline}</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">{surfaceDescription}</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {surfaceMap.map((surface) => (
              <article key={surface.title} className="rounded-xl border border-border/40 p-5 bg-card/50">
                <h3 className="headline-sm text-foreground mb-2">{surface.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{surface.body}</p>
                <Link href={surface.href} className="inline-flex items-center text-sm text-accent-info hover:text-accent-info/80 transition-colors">
                  {surface.cta}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-6 border-b border-border/20">
        <div className="max-w-6xl mx-auto mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="label-xs text-accent-info">Live Coverage</p>
              <h2 className="headline-lg text-foreground">Signal Feed</h2>
            </div>
            <Link href="/news" className="text-sm text-accent-info hover:text-accent-info/80 transition-colors">
              Open full Signal Feed
            </Link>
          </div>
        </div>
        <DailyNewsModule className="pt-0 pb-0" />
      </section>

      <section className="py-16 px-6 border-b border-border/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="headline-lg text-foreground mb-4">Methodology and evidence transparency</h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Build Atlas combines automated data collection with evidence-linked signal extraction so every conclusion can be traced and challenged.
          </p>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-2 text-accent-info hover:text-accent-info/80 transition-colors"
          >
            Read methodology
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {!session?.user && (
        <section id="personalize" className="py-16 px-6 border-b border-border/30">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="headline-lg text-foreground mb-4">{SIGN_IN_COPY.title}</h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">{SIGN_IN_COPY.body}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                {SIGN_IN_COPY.primaryCTA}
              </Link>
              <Link
                href="/dealbook"
                className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                {SIGN_IN_COPY.secondaryCTA}
              </Link>
            </div>
          </div>
        </section>
      )}

      {session?.user && (
        <section id="personalize" className="py-16 px-6 border-b border-border/30">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="headline-lg text-foreground mb-4">
              Welcome back, {session.user.name?.split(' ')[0] || 'there'}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
              Continue from your watchlist or move directly into dossier review.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/watchlist"
                className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                Open Watchlist
              </Link>
              <Link
                href="/dealbook"
                className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                Explore Dossiers
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="headline-lg text-foreground mb-10 text-center">Decision-critical FAQ</h2>
          <div className="space-y-5">
            {FAQ_ITEMS.map((item, index) => (
              <div key={index} className="pb-5 border-b border-border/30">
                <h3 className="text-sm font-medium text-foreground mb-2">{item.question}</h3>
                <p className="text-sm text-muted-foreground">{item.answer}</p>
              </div>
            ))}
            <div className="pb-5 border-b border-border/30">
              <h3 className="text-sm font-medium text-foreground mb-2">Need help evaluating a specific workflow?</h3>
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

      <footer className="py-10 px-6 border-t border-border/30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <BrandMark size="sm" variant="muted" />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-accent-info transition-colors">Methodology</Link>
            <Link href="/news" className="hover:text-accent-info transition-colors">Signal Feed</Link>
            <Link href="/brief" className="hover:text-accent-info transition-colors">Brief</Link>
            <Link href="/dealbook" className="hover:text-accent-info transition-colors">Dossiers</Link>
            <Link href="/attribution" className="hover:text-accent-info transition-colors">Attribution</Link>
            <Link href="/terms" className="hover:text-accent-info transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-accent-info transition-colors">Privacy</Link>
            <Link href="/support" className="hover:text-accent-info transition-colors">Support</Link>
            <a href="mailto:support@graph-atlas.com" className="hover:text-accent-info transition-colors">support@graph-atlas.com</a>
          </div>
          <p className="text-xs text-muted-foreground/60">© 2026 Build Atlas</p>
        </div>
      </footer>
    </div>
  );
}

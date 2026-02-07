import { Suspense } from 'react';
import { Card } from '@/components/ui';
import { getNewsletterMarkdown, getAvailablePeriods, getMonthlyStats } from '@/lib/data';
import { formatPeriod } from '@/lib/utils';
import { NewsletterRenderer } from '@/components/features';
import { Calendar, Download, Share2 } from 'lucide-react';
import { PeriodNav } from '@/components/ui/period-nav';
import { ReadingWrapper } from '@/components/ui/reading-wrapper';

const FALLBACK_PERIOD = '2026-01';

async function LibraryContent({ selectedMonth }: { selectedMonth?: string }) {
  const periods = await getAvailablePeriods();
  const latestPeriod = periods[0]?.period || FALLBACK_PERIOD;
  const period = (selectedMonth && periods.some(p => p.period === selectedMonth))
    ? selectedMonth
    : latestPeriod;
  const availableMonths = periods.map(p => p.period);

  const [markdown, stats] = await Promise.all([
    getNewsletterMarkdown(period),
    getMonthlyStats(period),
  ]);

  if (!markdown) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between pb-4 border-b border-border/30">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Library</h1>
            <p className="text-sm text-muted-foreground">AI Landscape Briefs Archive</p>
          </div>
          <PeriodNav availableMonths={availableMonths} currentMonth={period} />
        </div>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <p className="text-muted-foreground">No newsletter available for this period.</p>
            <p className="text-sm text-muted-foreground/60 mt-2">
              Check back later or select a different period.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between pb-4 border-b border-border/30">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Library
              </h1>
              <p className="text-sm text-muted-foreground">
                AI Landscape Briefs Archive
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <span className="text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-full">
              {formatPeriod(period)}
            </span>
            <span className="text-xs text-muted-foreground/60">
              Monthly intelligence for AI builders and investors
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeriodNav availableMonths={availableMonths} currentMonth={period} />
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Share2 className="h-4 w-4" />
          </button>
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Newsletter Content */}
      <Card className="rounded-xl bg-card/50 backdrop-blur-sm border border-white/[0.04] overflow-hidden">
        <article className="p-8 md:p-12">
          <NewsletterRenderer content={markdown} />
        </article>
      </Card>

      {/* Footer */}
      <div className="text-center pb-8">
        <p className="text-xs text-muted-foreground/50">
          Generated with AI-powered analysis from {stats.deal_summary.total_deals} startup funding rounds
        </p>
      </div>
    </div>
  );
}

function LibraryLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 animate-pulse rounded-xl bg-muted" />
        <div>
          <div className="h-6 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted mt-2" />
        </div>
      </div>
      <div className="h-[800px] animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  return (
    <ReadingWrapper>
      <Suspense fallback={<LibraryLoading />}>
        <LibraryContent selectedMonth={month} />
      </Suspense>
    </ReadingWrapper>
  );
}

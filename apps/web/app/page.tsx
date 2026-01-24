import { Suspense } from 'react';
import {
  DollarSign,
  Building2,
  Cpu,
  TrendingUp,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { MetricsGrid, HighlightsWrapper, generateHighlights } from '@/components/features';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import {
  PatternBarChart,
  FundingDonutChart,
  GeographicChart,
  TopDealsChart,
  VerticalInvestmentChart,
  VerticalBubbleChart,
  ModelUsageChart,
} from '@/components/charts';
import {
  getMonthlyStats,
  getAvailablePeriods,
  getTopDeals,
  getVerticalStats,
  getInvestmentByVertical,
  getAISubVerticalStats,
  getModelUsageStats,
  getPatternStats,
} from '@/lib/data';

// Default to the current period
const DEFAULT_PERIOD = '2026-01';

async function DashboardContent() {
  const [stats, periods, topDeals, verticalStats, verticalInvestment, aiSubVerticals, modelUsage, patternStats] = await Promise.all([
    getMonthlyStats(DEFAULT_PERIOD),
    getAvailablePeriods(),
    getTopDeals(DEFAULT_PERIOD, 20),
    getVerticalStats(DEFAULT_PERIOD),
    getInvestmentByVertical(DEFAULT_PERIOD),
    getAISubVerticalStats(DEFAULT_PERIOD),
    getModelUsageStats(DEFAULT_PERIOD),
    getPatternStats(DEFAULT_PERIOD),
  ]);

  const genaiAnalysis = stats.genai_analysis;

  // Generate highlights
  const highlights = generateHighlights({
    pattern_distribution: genaiAnalysis.pattern_distribution,
    top_investors: stats.top_investors,
    funding_by_continent: stats.funding_by_continent,
  });

  // Get top patterns with percentages and startups for charts
  const patternData = patternStats.slice(0, 8);

  return (
    <DashboardLayout
      initialPeriod={DEFAULT_PERIOD}
      availablePeriods={periods.map((p) => p.period)}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div className="pb-3 border-b border-border/30">
          <h1 className="text-lg font-medium text-foreground">
            Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mono-numbers">
            AI Startup Funding Intelligence — January 2026
          </p>
        </div>

        {/* Key Metrics */}
        <MetricsGrid
          totalFunding={stats.deal_summary.total_funding_usd}
          totalDeals={stats.deal_summary.total_deals}
          genaiAdoptionRate={genaiAnalysis.genai_adoption_rate}
          averageDealSize={stats.deal_summary.average_deal_size}
        />

        {/* Top 20 Deals */}
        <Card className="glow-card border-border/50 overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/40 to-sky-500/40" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Top 20 Deals
              </span>
              <a
                href="/startups"
                className="text-[10px] text-primary/70 hover:text-primary transition-colors uppercase tracking-wider"
              >
                View all →
              </a>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TopDealsChart data={topDeals} height={500} />
          </CardContent>
        </Card>

        {/* Highlights & Patterns */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Highlights */}
          <HighlightsWrapper
            title="Key Insights"
            highlights={highlights}
            className="lg:col-span-1"
          />

          {/* Pattern Distribution Chart */}
          <Card className="lg:col-span-2 glow-card border-border/50 overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/40 to-sky-500/40" />
            <CardHeader className="pb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Build Patterns
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              <PatternBarChart data={patternData} height={260} />
            </CardContent>
          </Card>
        </div>

        {/* Vertical Analysis Section */}
        <div>
          <div className="section-header">
            Market & Vertical Analysis
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* GenAI Adoption vs Market Activity Bubble Chart */}
            <Card className="glow-card border-border/50">
              <CardHeader className="pb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                  GenAI Adoption vs Activity
                </span>
              </CardHeader>
              <CardContent className="pt-0">
                <VerticalBubbleChart data={verticalStats} height={350} />
              </CardContent>
            </Card>

            {/* Investment by Vertical */}
            <Card className="glow-card border-border/50">
              <CardHeader className="pb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                  Investment by Vertical
                </span>
              </CardHeader>
              <CardContent className="pt-0">
                <VerticalInvestmentChart data={verticalInvestment} height={350} maxItems={8} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* AI Sub-verticals & Model Usage */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* AI/ML Sub-verticals */}
          <Card className="glow-card border-border/50">
            <CardHeader className="pb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                AI/ML Sub-verticals
              </span>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Horizontal AI investment breakdown</p>
            </CardHeader>
            <CardContent className="pt-0">
              <VerticalInvestmentChart data={aiSubVerticals} height={320} maxItems={10} />
            </CardContent>
          </Card>

          {/* Model Usage */}
          <Card className="glow-card border-border/50">
            <CardHeader className="pb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Model Provider Funding
              </span>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 mono-numbers">
                {modelUsage.reduce((sum, m) => sum + m.startupCount, 0)} startups disclosed
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <ModelUsageChart data={modelUsage} height={280} />
              {/* Top startups by model */}
              <div className="mt-3 space-y-2 p-2.5 rounded bg-muted/20 border border-border/30">
                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Top by provider</p>
                {modelUsage.slice(0, 3).map((model) => (
                  <div key={model.provider} className="text-[10px]">
                    <p className="font-medium text-foreground/80 mb-1">{model.displayName}:</p>
                    <div className="flex flex-wrap gap-1">
                      {model.startups.slice(0, 4).map((s) => (
                        <a
                          key={s.slug}
                          href={`/startups/${s.slug}`}
                          className="inline-block"
                        >
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 h-5 hover:border-primary/40 hover:text-primary transition-colors cursor-pointer"
                          >
                            {s.name}
                          </Badge>
                        </a>
                      ))}
                      {model.startups.length > 4 && (
                        <Badge variant="secondary" className="text-[9px] py-0 h-5">
                          +{model.startups.length - 4}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Funding Charts */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Funding by Stage */}
          <Card className="glow-card border-border/50">
            <CardHeader className="pb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Funding by Stage
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              <FundingDonutChart data={stats.funding_by_stage} height={260} />
            </CardContent>
          </Card>

          {/* Geographic Distribution */}
          <Card className="glow-card border-border/50">
            <CardHeader className="pb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                Funding by Region
              </span>
            </CardHeader>
            <CardContent className="pt-0">
              <GeographicChart data={stats.funding_by_continent} height={230} />
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function DashboardLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-6 lg:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}

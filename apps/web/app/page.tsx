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
      <div className="space-y-8">
        {/* Page Header */}
        <div className="py-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            AI Startup Funding Intelligence for January 2026
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
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                Top 20 Deals
              </CardTitle>
              <a
                href="/startups"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <TopDealsChart data={topDeals} height={550} />
          </CardContent>
        </Card>

        {/* Highlights & Patterns */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Highlights */}
          <HighlightsWrapper
            title="January Highlights"
            highlights={highlights}
            className="lg:col-span-1"
          />

          {/* Pattern Distribution Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                Build Patterns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PatternBarChart data={patternData} height={280} />
            </CardContent>
          </Card>
        </div>

        {/* Vertical Analysis Section */}
        <div>
          <h2 className="text-base font-medium mb-4 flex items-center gap-2 text-muted-foreground">
            <Building2 className="h-4 w-4" />
            Market & Vertical Analysis
          </h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* GenAI Adoption vs Market Activity Bubble Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">GenAI Adoption vs Market Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <VerticalBubbleChart data={verticalStats} height={380} />
              </CardContent>
            </Card>

            {/* Investment by Vertical */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Investment by Vertical</CardTitle>
              </CardHeader>
              <CardContent>
                <VerticalInvestmentChart data={verticalInvestment} height={380} maxItems={8} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* AI Sub-verticals & Model Usage */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* AI/ML Sub-verticals */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                AI/ML Sub-verticals
              </CardTitle>
              <p className="text-xs text-muted-foreground">Breakdown of horizontal AI investments</p>
            </CardHeader>
            <CardContent>
              <VerticalInvestmentChart data={aiSubVerticals} height={350} maxItems={10} />
            </CardContent>
          </Card>

          {/* Model Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Funding by Model Provider
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Only startups that disclosed model usage ({modelUsage.reduce((sum, m) => sum + m.startupCount, 0)} startups)
              </p>
            </CardHeader>
            <CardContent>
              <ModelUsageChart data={modelUsage} height={300} />
              {/* Top startups by model */}
              <div className="mt-4 space-y-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-xs font-medium text-muted-foreground">Top startups by model provider:</p>
                {modelUsage.slice(0, 3).map((model) => (
                  <div key={model.provider} className="text-xs">
                    <p className="font-medium text-foreground mb-1.5">{model.displayName}:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {model.startups.slice(0, 4).map((s) => (
                        <a
                          key={s.slug}
                          href={`/startups/${s.slug}`}
                          className="inline-block"
                        >
                          <Badge
                            variant="outline"
                            className="text-xs hover:bg-muted transition-colors cursor-pointer"
                          >
                            {s.name}
                          </Badge>
                        </a>
                      ))}
                      {model.startups.length > 4 && (
                        <Badge variant="secondary" className="text-xs">
                          +{model.startups.length - 4} more
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
        <div className="grid gap-6 md:grid-cols-2">
          {/* Funding by Stage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funding by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <FundingDonutChart data={stats.funding_by_stage} height={280} />
            </CardContent>
          </Card>

          {/* Geographic Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funding by Region</CardTitle>
            </CardHeader>
            <CardContent>
              <GeographicChart data={stats.funding_by_continent} height={250} />
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

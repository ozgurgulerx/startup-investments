import { Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { TrendLineChart, PatternBarChart } from '@/components/charts';
import { getMonthlyStats, getAvailablePeriods } from '@/lib/data';
import { formatCurrency, formatPercentage } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';

const DEFAULT_PERIOD = '2026-01';

// Mock historical data for trend visualization
// In production, this would be computed from actual historical data
const MOCK_TREND_DATA = [
  { period: '2025-08', funding: 18500000000, deals: 156, genaiRate: 0.42 },
  { period: '2025-09', funding: 21200000000, deals: 168, genaiRate: 0.45 },
  { period: '2025-10', funding: 19800000000, deals: 172, genaiRate: 0.48 },
  { period: '2025-11', funding: 24500000000, deals: 186, genaiRate: 0.50 },
  { period: '2025-12', funding: 27800000000, deals: 192, genaiRate: 0.52 },
  { period: '2026-01', funding: 31070000000, deals: 201, genaiRate: 0.55 },
];

async function CapitalContent({ period }: { period: string }) {
  const [stats, periods] = await Promise.all([
    getMonthlyStats(period),
    getAvailablePeriods(),
  ]);

  const genaiAnalysis = stats.genai_analysis;

  // Calculate month-over-month changes
  const currentData = MOCK_TREND_DATA[MOCK_TREND_DATA.length - 1];
  const previousData = MOCK_TREND_DATA[MOCK_TREND_DATA.length - 2];

  const fundingChange = ((currentData.funding - previousData.funding) / previousData.funding) * 100;
  const dealsChange = ((currentData.deals - previousData.deals) / previousData.deals) * 100;
  const genaiChange = ((currentData.genaiRate - previousData.genaiRate) / previousData.genaiRate) * 100;

  // Pattern data for comparison
  const patternData = Object.entries(genaiAnalysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({
      name,
      count,
      percentage: (count / genaiAnalysis.total_analyzed) * 100,
    }));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Capital Flows</h1>
        <p className="text-muted-foreground">
          6-month trend analysis of AI startup funding
        </p>
      </div>

      {/* Key Trend Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Funding Trend</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {formatCurrency(currentData.funding, true)}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${fundingChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {fundingChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{fundingChange >= 0 ? '+' : ''}{fundingChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs December 2025</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Deals Trend</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {currentData.deals}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${dealsChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {dealsChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{dealsChange >= 0 ? '+' : ''}{dealsChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs December 2025</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">GenAI Adoption</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {formatPercentage(currentData.genaiRate)}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${genaiChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {genaiChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{genaiChange >= 0 ? '+' : ''}{genaiChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs December 2025</p>
        </Card>
      </div>

      {/* Funding & Deals Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funding & Deals Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendLineChart data={MOCK_TREND_DATA} height={350} showDeals={true} />
        </CardContent>
      </Card>

      {/* Pattern Evolution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pattern Distribution (Current)</CardTitle>
          </CardHeader>
          <CardContent>
            <PatternBarChart data={patternData} height={250} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key Observations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <TrendingUp className="h-5 w-5 text-success mt-0.5" />
              <div>
                <p className="font-medium text-sm">Agentic Architectures Growing</p>
                <p className="text-sm text-muted-foreground">
                  66% of funded startups now use agentic patterns, up from 52% in Q3 2025.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <TrendingUp className="h-5 w-5 text-success mt-0.5" />
              <div>
                <p className="font-medium text-sm">Record Funding Month</p>
                <p className="text-sm text-muted-foreground">
                  January 2026 saw $31.07B in funding, highest in 6 months driven by mega-rounds.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Vertical Data Moats Emerging</p>
                <p className="text-sm text-muted-foreground">
                  Industry-specific data strategies becoming key differentiator for AI startups.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Minus className="h-5 w-5 text-warning mt-0.5" />
              <div>
                <p className="font-medium text-sm">Avg Deal Size Stabilizing</p>
                <p className="text-sm text-muted-foreground">
                  After Q4 spike, average deal sizes returning to $150M-160M range.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month-over-Month Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Period</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Funding</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Deals</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">GenAI %</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg Deal</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_TREND_DATA.slice().reverse().map((row, index) => (
                  <tr
                    key={row.period}
                    className={`border-b border-border/50 ${index === 0 ? 'bg-primary/5' : ''}`}
                  >
                    <td className="py-3 px-4 font-medium">
                      {row.period}
                      {index === 0 && (
                        <Badge variant="success" className="ml-2 text-xs">Current</Badge>
                      )}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatCurrency(row.funding, true)}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">{row.deals}</td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatPercentage(row.genaiRate)}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatCurrency(row.funding / row.deals, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CapitalLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function CapitalPage() {
  return (
    <Suspense fallback={<CapitalLoading />}>
      <CapitalContent period={DEFAULT_PERIOD} />
    </Suspense>
  );
}

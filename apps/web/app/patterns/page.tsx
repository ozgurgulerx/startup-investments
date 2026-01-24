import { Suspense } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { getMonthlyStats, getStartups, getAvailablePeriods } from '@/lib/data';
import { formatPercentage, cn } from '@/lib/utils';

const DEFAULT_PERIOD = '2026-01';

// Pattern descriptions
const PATTERN_DESCRIPTIONS: Record<string, string> = {
  'Agentic Architectures':
    'Autonomous AI systems that can take actions, use tools, and operate with minimal human intervention.',
  'Vertical Data Moats':
    'Industry-specific proprietary datasets that create competitive advantages and improve model performance.',
  'RAG (Retrieval-Augmented Generation)':
    'Combining LLMs with document retrieval for grounded, factual responses.',
  'Micro-model Meshes':
    'Multiple specialized models working together, each optimized for specific tasks.',
  'Continuous-learning Flywheels':
    'Systems where user interactions continuously improve the underlying models.',
  'Guardrail-as-LLM':
    'Secondary AI models that check and validate outputs from primary models.',
  'Knowledge Graphs':
    'Structured representations of entities and relationships for enhanced reasoning.',
  'Natural-Language-to-Code':
    'Converting natural language instructions into executable code.',
};

async function PatternsContent() {
  const [stats, startups, periods] = await Promise.all([
    getMonthlyStats(DEFAULT_PERIOD),
    getStartups(DEFAULT_PERIOD),
    getAvailablePeriods(),
  ]);

  const patternDistribution = stats.genai_analysis.pattern_distribution;
  const totalAnalyzed = stats.genai_analysis.total_analyzed;

  // Sort patterns by count
  const patterns = Object.entries(patternDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      percentage: count / totalAnalyzed,
      description: PATTERN_DESCRIPTIONS[name] || 'Emerging pattern in AI development.',
      // For now, mock trend data - in production, compute from historical data
      trend: count > 100 ? 'growing' : count > 50 ? 'stable' : 'emerging',
      exampleCompanies: startups
        .filter((s) => s.build_patterns?.some((p) => p.name === name))
        .slice(0, 3)
        .map((s) => s.company_name),
    }));

  return (
    <DashboardLayout
      initialPeriod={DEFAULT_PERIOD}
      availablePeriods={periods.map((p) => p.period)}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold">Build Patterns</h1>
          <p className="text-muted-foreground">
            Common architectural patterns detected across {totalAnalyzed} analyzed startups
          </p>
        </div>

        {/* Pattern Grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          {patterns.map((pattern) => (
            <Card key={pattern.name} className="card-hover">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{pattern.name}</CardTitle>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-2xl font-bold tabular-nums">
                        {pattern.count}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        startups ({formatPercentage(pattern.percentage)})
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant={
                      pattern.trend === 'growing'
                        ? 'success'
                        : pattern.trend === 'emerging'
                        ? 'warning'
                        : 'secondary'
                    }
                    className="gap-1"
                  >
                    {pattern.trend === 'growing' && (
                      <TrendingUp className="h-3 w-3" />
                    )}
                    {pattern.trend === 'stable' && (
                      <Minus className="h-3 w-3" />
                    )}
                    {pattern.trend === 'emerging' && (
                      <TrendingUp className="h-3 w-3" />
                    )}
                    {pattern.trend}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {pattern.description}
                </p>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        pattern.trend === 'growing'
                          ? 'bg-success'
                          : pattern.trend === 'emerging'
                          ? 'bg-warning'
                          : 'bg-primary'
                      )}
                      style={{ width: `${pattern.percentage * 100}%` }}
                    />
                  </div>
                </div>

                {/* Example companies */}
                {pattern.exampleCompanies.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-2">
                      Example companies:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {pattern.exampleCompanies.map((company) => (
                        <Badge key={company} variant="outline" className="text-xs">
                          {company}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

function PatternsLoading() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function PatternsPage() {
  return (
    <Suspense fallback={<PatternsLoading />}>
      <PatternsContent />
    </Suspense>
  );
}

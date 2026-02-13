'use client';

import { useState, useEffect, useTransition, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MonthSwitcher, formatMonthLabel } from '@/components/ui/month-switcher';
import { formatCurrency } from '@/lib/utils';

// Briefing data shape
export interface BriefingData {
  period: string;
  insight: string;
  context: string;
  stats: {
    totalFunding: number;
    totalDeals: number;
    genaiAdoptionRate: number;
  };
  topDeals: Array<{
    slug: string;
    name: string;
    vertical: string;
    funding: number;
  }>;
  topPatterns: Array<{
    name: string;
    count: number;
    companies: string[];
  }>;
  geographicDistribution: Array<{
    region: string;
    amount: number;
    percentage: number;
  }>;
}

interface BriefingClientProps {
  initialData: BriefingData;
  availablePeriods: string[];
}

// Simple number animation hook
function useAnimatedNumber(target: number, duration: number = 400): number {
  const [current, setCurrent] = useState(target);

  useEffect(() => {
    let rafId: number;
    const startValue = current;
    const startTime = performance.now();

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const newValue = startValue + (target - startValue) * eased;

      setCurrent(newValue);

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    }

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration]);

  return current;
}

// Animated stat component
function AnimatedStat({
  value,
  label,
  format,
}: {
  value: number;
  label: string;
  format: 'currency' | 'number' | 'percent';
}) {
  const animatedValue = useAnimatedNumber(value);

  const formatted = useMemo(() => {
    switch (format) {
      case 'currency':
        return formatCurrency(animatedValue, true);
      case 'percent':
        return `${Math.round(animatedValue)}%`;
      default:
        return Math.round(animatedValue).toString();
    }
  }, [animatedValue, format]);

  return (
    <div className="briefing-stat">
      <span className="briefing-stat-value">{formatted}</span>
      <span className="briefing-stat-label">{label}</span>
    </div>
  );
}

// Cache for fetched briefing data
const dataCache = new Map<string, BriefingData>();

export function BriefingClient({ initialData, availablePeriods }: BriefingClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [urlMonth, setUrlMonth] = useState<string | null>(null);

  // Get current period from URL or default to initial
  const currentPeriod = urlMonth || initialData.period;

  // Validate the period
  const validPeriod = availablePeriods.includes(currentPeriod)
    ? currentPeriod
    : availablePeriods[0] || initialData.period;

  // State for briefing data
  const [data, setData] = useState<BriefingData>(() => {
    // Cache initial data
    dataCache.set(initialData.period, initialData);
    return initialData;
  });

  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Initialize + keep URL month in sync on browser back/forward.
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search || '');
      setUrlMonth(params.get('month'));
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Fetch briefing data for a period
  const fetchBriefingData = useCallback(async (period: string): Promise<BriefingData> => {
    // Check cache first
    if (dataCache.has(period)) {
      return dataCache.get(period)!;
    }

    // Fetch from static JSON
    const response = await fetch(`/data/briefings/${period}.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch briefing for ${period}`);
    }

    const briefingData = await response.json() as BriefingData;
    dataCache.set(period, briefingData);
    return briefingData;
  }, []);

  // Handle month change
  const handleMonthChange = useCallback(async (newPeriod: string) => {
    if (newPeriod === validPeriod) return;

    setIsLoading(true);
    const currentFetchId = ++fetchIdRef.current;

    try {
      // Update URL (shallow)
      startTransition(() => {
        const params = new URLSearchParams(window.location.search || '');
        params.set('month', newPeriod);
        router.push(`?${params.toString()}`, { scroll: false });
      });
      setUrlMonth(newPeriod);

      // Fetch new data
      const newData = await fetchBriefingData(newPeriod);

      // Discard if a newer request was made while we were fetching
      if (currentFetchId !== fetchIdRef.current) return;

      // Small delay to allow content fade
      await new Promise(resolve => setTimeout(resolve, 100));

      setData(newData);
    } catch (error) {
      console.error('Failed to load briefing:', error);
      // Stay on current data if fetch fails
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [validPeriod, router, fetchBriefingData]);

  // Sync data when URL changes (e.g., browser back/forward)
  useEffect(() => {
    if (validPeriod === data.period || isLoading) return;

    const currentFetchId = ++fetchIdRef.current;
    let cancelled = false;

    fetchBriefingData(validPeriod)
      .then((newData) => {
        if (cancelled) return;
        if (currentFetchId !== fetchIdRef.current) return;
        setData(newData);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to sync briefing from URL:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [validPeriod, data.period, isLoading, fetchBriefingData]);

  // Get display month
  const displayMonth = formatMonthLabel(data.period).toLowerCase();

  return (
    <>
      {/* Briefing Header */}
      <header className="briefing-header">
        {/* Month Switcher */}
        <MonthSwitcher
          availableMonths={availablePeriods}
          value={validPeriod}
          onChange={handleMonthChange}
          className="mb-4"
        />

        {/* Content with fade transition */}
        <div
          className={`transition-opacity duration-150 ${
            isLoading ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <h1 className="briefing-headline">
            {data.insight}
          </h1>
          <p className="briefing-subhead">
            {data.context}
          </p>

          {/* Key figures with animated numbers */}
          <div className="briefing-stats">
            <AnimatedStat
              value={data.stats.totalFunding}
              label="Total Capital"
              format="currency"
            />
            <AnimatedStat
              value={data.stats.totalDeals}
              label="Deals"
              format="number"
            />
            <AnimatedStat
              value={data.stats.genaiAdoptionRate}
              label="GenAI Adoption"
              format="percent"
            />
          </div>
        </div>
      </header>

      {/* Intelligence Callout */}
      <div
        className={`intel-callout transition-opacity duration-150 ${
          isLoading ? 'opacity-60' : 'opacity-100'
        }`}
      >
        <span className="intel-callout-label">What This Enables</span>
        <p className="intel-callout-text">
          The concentration in agentic infrastructure suggests a 12-18 month window before
          application-layer companies can reliably build on stable primitives. Enterprise
          buyers may delay procurement decisions until tool interoperability matures.
        </p>
      </div>

      {/* Top Deals Section */}
      <section className="section">
        <div className="section-header">
          <span className="section-title">Notable Rounds</span>
          <Link href="/dealbook" className="section-link">
            View all companies
          </Link>
        </div>

        <div
          className={`divide-subtle transition-opacity duration-150 ${
            isLoading ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {data.topDeals.slice(0, 8).map((deal, index) => (
            <Link
              key={deal.slug}
              href={`/company/${deal.slug}`}
              className="deals-row"
            >
              <span className="deals-rank">{index + 1}</span>
              <span className="deals-name">{deal.name}</span>
              <span className="deals-vertical">{deal.vertical}</span>
              <span className="deals-amount">{formatCurrency(deal.funding, true)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Build Signals Section */}
      <section className="section">
        <div className="section-header">
          <span className="section-title">Dominant Build Patterns</span>
          <Link href="/signals" className="section-link">
            Full signal analysis
          </Link>
        </div>

        <div
          className={`space-y-6 transition-opacity duration-150 ${
            isLoading ? 'opacity-60' : 'opacity-100'
          }`}
        >
          {data.topPatterns.slice(0, 3).map(({ name, count, companies }) => (
            <div key={name} className="py-4 border-b border-border/30 last:border-0">
              <div className="flex items-start justify-between gap-8 mb-2">
                <h3 className="headline-sm">{name}</h3>
                <span className="text-sm text-muted-foreground">
                  {count} companies
                </span>
              </div>

              {companies.length > 0 && (
                <p className="body-sm">
                  Notable: {companies.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Geographic Distribution */}
      <section className="section">
        <div className="section-header">
          <span className="section-title">Geographic Distribution</span>
        </div>

        <div
          className={`transition-opacity duration-150 ${
            isLoading ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <p className="body-md max-w-prose mb-6">
            {data.geographicDistribution[0] && (
              <>
                {data.geographicDistribution[0].region} accounts for{' '}
                {data.geographicDistribution[0].percentage}% of total capital deployed
                {data.geographicDistribution.length > 2 && (
                  <>, with {data.geographicDistribution.slice(1, 3).map(r => r.region).join(' and ')} representing meaningful secondary activity</>
                )}.
              </>
            )}
          </p>

          <div className="flex gap-10">
            {data.geographicDistribution.slice(0, 4).map(({ region, amount }) => (
              <div key={region} className="flex flex-col">
                <span className="num-md text-foreground/80">
                  {formatCurrency(amount, true)}
                </span>
                <span className="label-xs mt-1">{region}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { RegionToggle } from '@/components/ui/region-toggle';
import { PeriodNav } from '@/components/ui/period-nav';
import { OverviewTab } from './overview-tab';
import { DealsTab } from './deals-tab';
import { InvestorsTab } from './investors-tab';
import { PatternsTab } from './patterns-tab';
import { CompareTab } from './compare-tab';
import { DrillDownDrawer, type DrillDownFilter } from './drill-down-drawer';
import type { MonthlyStats, StartupAnalysis } from '@startup-intelligence/shared';
import type { ConcentrationMetrics, OutlierRound, StageAnomaly, LorenzPoint, ParetoPoint } from '@/lib/data/anomalies';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'deals', label: 'Deals' },
  { key: 'investors', label: 'Investors' },
  { key: 'patterns', label: 'Patterns' },
  { key: 'compare', label: 'Compare' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export interface InvestorMomentumEntry {
  name: string;
  currentRank: number;
  prevRank: number | null;
  rankChange: number;
  isNew: boolean;
}

export interface CapitalTabProps {
  multiPeriodStats: MonthlyStats[];
  currentStats: MonthlyStats;
  previousStats: MonthlyStats | null;
  startups: StartupAnalysis[];
  prevStartups: StartupAnalysis[];
  concentrationMetrics: ConcentrationMetrics;
  lorenzData: LorenzPoint[];
  paretoData: ParetoPoint[];
  outliers: OutlierRound[];
  stageAnomalies: StageAnomaly[];
  investorMomentum: InvestorMomentumEntry[];
  availableMonths: string[];
  currentPeriod: string;
  region?: string;
  onDrillDown?: (filter: DrillDownFilter) => void;
  // Compare tab specific (loaded optionally)
  turkeyStats?: MonthlyStats | null;
  turkeyStartups?: StartupAnalysis[];
}

interface InteractiveCapitalProps {
  multiPeriodStats: MonthlyStats[];
  currentStats: MonthlyStats;
  previousStats: MonthlyStats | null;
  startups: StartupAnalysis[];
  prevStartups: StartupAnalysis[];
  concentrationMetrics: ConcentrationMetrics;
  lorenzData: LorenzPoint[];
  paretoData: ParetoPoint[];
  outliers: OutlierRound[];
  stageAnomalies: StageAnomaly[];
  investorMomentum: InvestorMomentumEntry[];
  availableMonths: string[];
  currentPeriod: string;
  region?: string;
  turkeyStats?: MonthlyStats | null;
  turkeyStartups?: StartupAnalysis[];
}

export function InteractiveCapital(props: InteractiveCapitalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab') || 'overview';
  const activeTab = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview';

  const [drillDownFilter, setDrillDownFilter] = useState<DrillDownFilter>(null);

  const setTab = useCallback(
    (tab: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'overview') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const handleDrillDown = useCallback((filter: DrillDownFilter) => {
    setDrillDownFilter(filter);
  }, []);

  const tabProps: CapitalTabProps = {
    ...props,
    onDrillDown: handleDrillDown,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="label-xs text-accent-info">Capital Flows</p>
          <h1 className="headline-lg">Capital Market Debugger</h1>
        </div>
        <div className="flex items-center gap-2">
          <RegionToggle />
          <PeriodNav availableMonths={props.availableMonths} currentMonth={props.currentPeriod} />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border/30">
        <nav className="flex gap-1 overflow-x-auto -mb-px" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setTab(tab.key)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'overview' && <OverviewTab {...tabProps} />}
      {activeTab === 'deals' && <DealsTab {...tabProps} />}
      {activeTab === 'investors' && <InvestorsTab {...tabProps} />}
      {activeTab === 'patterns' && <PatternsTab {...tabProps} />}
      {activeTab === 'compare' && <CompareTab {...tabProps} />}

      {/* Drill-down Drawer */}
      <DrillDownDrawer
        filter={drillDownFilter}
        startups={props.startups}
        onClose={() => setDrillDownFilter(null)}
        region={props.region}
        currentPeriod={props.currentPeriod}
      />
    </div>
  );
}

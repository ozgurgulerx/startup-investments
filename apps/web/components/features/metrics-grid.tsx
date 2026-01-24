'use client';

import { DollarSign, Building2, Cpu, TrendingUp } from 'lucide-react';
import { MetricsCard } from './metrics-card';
import { formatCurrency, formatPercentage } from '@/lib/utils';

interface MetricsGridProps {
  totalFunding: number;
  totalDeals: number;
  genaiAdoptionRate: number;
  averageDealSize: number;
}

export function MetricsGrid({
  totalFunding,
  totalDeals,
  genaiAdoptionRate,
  averageDealSize,
}: MetricsGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricsCard
        title="Total Funding"
        value={formatCurrency(totalFunding, true)}
        change={{ value: '+12%', direction: 'up' }}
        subtitle="vs last month"
        Icon={DollarSign}
        variant="blue"
        tooltip="Total funding raised by AI startups this month"
        sparkline={[4.2, 4.5, 4.1, 4.8, 5.2, 5.5, 5.8, 6.2]}
        index={0}
      />
      <MetricsCard
        title="Deals"
        value={totalDeals.toString()}
        change={{ value: '+8%', direction: 'up' }}
        subtitle="vs last month"
        Icon={Building2}
        variant="green"
        tooltip="Number of funding deals closed this month"
        sparkline={[28, 32, 30, 35, 38, 42, 45, 48]}
        index={1}
      />
      <MetricsCard
        title="GenAI Adoption"
        value={formatPercentage(genaiAdoptionRate)}
        change={{ value: '+5%', direction: 'up' }}
        subtitle="vs last month"
        Icon={Cpu}
        variant="purple"
        tooltip="Percentage of startups using generative AI technologies"
        sparkline={[62, 65, 68, 70, 72, 75, 78, 82]}
        index={2}
      />
      <MetricsCard
        title="Avg Deal Size"
        value={formatCurrency(averageDealSize, true)}
        change={{ value: '-3%', direction: 'down' }}
        subtitle="vs last month"
        Icon={TrendingUp}
        variant="orange"
        tooltip="Average funding amount per deal"
        sparkline={[18, 19, 17, 16, 15, 14, 13, 12]}
        index={3}
      />
    </div>
  );
}

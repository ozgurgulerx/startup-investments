'use client';

import { ResponsivePie } from '@nivo/pie';
import { NEWSLETTER_THEME } from './nivo-theme';

interface MarketDna {
  horizontal: number;
  vertical: number;
  total: number;
}

const FILLS = {
  horizontal: 'hsl(192, 55%, 45%)',
  vertical: 'hsl(40, 50%, 48%)',
};

export function MarketDonut({ data }: { data: MarketDna }) {
  const total = data.horizontal + data.vertical;
  const chartData = [
    {
      id: 'Horizontal platforms',
      label: 'Horizontal platforms',
      value: data.horizontal,
      pct: total ? Math.round((data.horizontal / total) * 100) : 0,
      color: FILLS.horizontal,
    },
    {
      id: 'Vertical specialists',
      label: 'Vertical specialists',
      value: data.vertical,
      pct: total ? Math.round((data.vertical / total) * 100) : 0,
      color: FILLS.vertical,
    },
  ];

  return (
    <div className="flex items-center gap-6">
      <div style={{ width: 180, height: 180 }}>
        <ResponsivePie
          data={chartData}
          innerRadius={0.6}
          padAngle={2}
          cornerRadius={4}
          activeOuterRadiusOffset={6}
          colors={{ datum: 'data.color' }}
          borderWidth={2}
          borderColor="hsl(220, 18%, 10%)"
          enableArcLinkLabels={false}
          enableArcLabels={false}
          tooltip={({ datum }) => (
            <div className="bg-card border border-border/40 px-3 py-2 rounded text-sm">
              <p className="text-foreground font-medium">{datum.id}</p>
              <p className="text-muted-foreground">
                {datum.value} companies ({datum.data.pct}%)
              </p>
            </div>
          )}
          animate={true}
          motionConfig="gentle"
          theme={NEWSLETTER_THEME}
        />
      </div>
      <div className="space-y-3">
        {chartData.map((d) => (
          <div key={d.id} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: d.color }}
            />
            <span className="body-sm text-muted-foreground">
              {d.label}: <span className="text-foreground font-medium">{d.value}/{total}</span> ({d.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { formatCurrency } from '@/lib/utils';
import type { LorenzPoint, ParetoPoint } from '@/lib/data/anomalies';

interface ConcentrationChartProps {
  lorenzData: LorenzPoint[];
  paretoData: ParetoPoint[];
  giniCoefficient: number;
  height?: number;
  onClickDeal?: (slug: string) => void;
}

export function ConcentrationChart({
  lorenzData,
  paretoData,
  giniCoefficient,
  height = 280,
  onClickDeal,
}: ConcentrationChartProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2" style={{ minHeight: height }}>
      {/* Lorenz Curve */}
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h4 className="text-sm font-medium">Lorenz Curve</h4>
          <span className="text-xs text-muted-foreground">Gini: {giniCoefficient.toFixed(2)}</span>
        </div>
        <LorenzSVG data={lorenzData} />
      </div>

      {/* Pareto Chart */}
      <div>
        <h4 className="text-sm font-medium mb-3">Top Deals — Cumulative Share</h4>
        <ParetoTable data={paretoData} onClickDeal={onClickDeal} />
      </div>
    </div>
  );
}

function LorenzSVG({ data }: { data: LorenzPoint[] }) {
  const size = 200;
  const pad = 28;
  const innerSize = size - pad * 2;

  const toX = (pct: number) => pad + (pct / 100) * innerSize;
  const toY = (pct: number) => pad + innerSize - (pct / 100) * innerSize;

  const lorenzPath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[240px]">
      {/* Grid */}
      {[25, 50, 75].map((v) => (
        <g key={v}>
          <line
            x1={toX(0)} y1={toY(v)} x2={toX(100)} y2={toY(v)}
            stroke="hsl(var(--border) / 0.3)" strokeDasharray="2 2"
          />
          <line
            x1={toX(v)} y1={toY(0)} x2={toX(v)} y2={toY(100)}
            stroke="hsl(var(--border) / 0.3)" strokeDasharray="2 2"
          />
        </g>
      ))}

      {/* Equality line */}
      <line
        x1={toX(0)} y1={toY(0)} x2={toX(100)} y2={toY(100)}
        stroke="hsl(var(--muted-foreground) / 0.4)" strokeDasharray="4 3"
      />

      {/* Lorenz curve */}
      <path d={lorenzPath} fill="none" stroke="hsl(var(--chart-1))" strokeWidth={2} />

      {/* Shaded area */}
      <path
        d={`${lorenzPath} L${toX(100)},${toY(100)} L${toX(0)},${toY(0)} Z`}
        fill="hsl(var(--chart-1) / 0.1)"
      />

      {/* Axis labels */}
      <text x={size / 2} y={size - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
        Cumulative % of Deals
      </text>
      <text
        x={6} y={size / 2}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize={9}
        transform={`rotate(-90, 6, ${size / 2})`}
      >
        Cumulative % of Funding
      </text>
    </svg>
  );
}

function ParetoTable({
  data,
  onClickDeal,
}: {
  data: ParetoPoint[];
  onClickDeal?: (slug: string) => void;
}) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Insufficient data</p>;

  return (
    <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left py-1 pr-2">#</th>
            <th className="text-left py-1 pr-2">Company</th>
            <th className="text-right py-1 pr-2">Amount</th>
            <th className="text-right py-1">Cum %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr
              key={d.rank}
              className={onClickDeal ? 'hover:bg-muted/20 cursor-pointer' : ''}
              onClick={() => onClickDeal?.(d.slug)}
            >
              <td className="py-1 pr-2 tabular-nums text-muted-foreground">{d.rank}</td>
              <td className="py-1 pr-2 truncate max-w-[120px]">{d.name}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatCurrency(d.amount, true)}</td>
              <td className="py-1 text-right tabular-nums font-medium">{d.cumShare.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

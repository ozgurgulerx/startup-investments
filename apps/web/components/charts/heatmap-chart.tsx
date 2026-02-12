'use client';

import { cn } from '@/lib/utils';

export interface HeatmapCell {
  row: string;
  col: string;
  value: number;
}

interface HeatmapChartProps {
  data: HeatmapCell[];
  rows: string[];
  cols: string[];
  rowLabel?: string;
  colLabel?: string;
  onClick?: (row: string, col: string) => void;
}

function getHeatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'transparent';
  const intensity = Math.min(value / max, 1);
  // Use chart-1 color with variable opacity
  return `hsl(var(--chart-1) / ${(0.15 + intensity * 0.7).toFixed(2)})`;
}

export function HeatmapChart({ data, rows, cols, rowLabel, colLabel, onClick }: HeatmapChartProps) {
  const cellMap = new Map<string, number>();
  let maxVal = 0;
  for (const cell of data) {
    const key = `${cell.row}|${cell.col}`;
    cellMap.set(key, cell.value);
    if (cell.value > maxVal) maxVal = cell.value;
  }

  const shortStage: Record<string, string> = {
    seed: 'Seed',
    pre_seed: 'Pre',
    series_a: 'A',
    series_b: 'B',
    series_c: 'C',
    series_d_plus: 'D+',
    late_stage: 'Late',
    growth: 'Grwth',
    unknown: '?',
  };

  return (
    <div className="overflow-x-auto">
      {colLabel && (
        <p className="text-[10px] text-muted-foreground text-center mb-1">{colLabel}</p>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="text-left p-1 text-muted-foreground font-normal">{rowLabel || ''}</th>
            {cols.map((c) => (
              <th key={c} className="p-1 text-center text-muted-foreground font-normal whitespace-nowrap">
                {shortStage[c] || c.slice(0, 8)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="p-1 text-muted-foreground truncate max-w-[100px]" title={r}>
                {r.length > 14 ? r.slice(0, 13) + '...' : r}
              </td>
              {cols.map((c) => {
                const val = cellMap.get(`${r}|${c}`) || 0;
                return (
                  <td
                    key={c}
                    className={cn(
                      'p-1 text-center tabular-nums border border-border/20 rounded-sm',
                      onClick && val > 0 && 'cursor-pointer hover:ring-1 hover:ring-accent',
                    )}
                    style={{ backgroundColor: getHeatColor(val, maxVal) }}
                    onClick={() => val > 0 && onClick?.(r, c)}
                    title={`${r} × ${shortStage[c] || c}: ${val}`}
                  >
                    {val > 0 ? val : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

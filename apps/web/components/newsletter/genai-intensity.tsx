'use client';

import { ResponsiveBar } from '@nivo/bar';
import { NEWSLETTER_THEME, LINKEDIN_THEME, LINKEDIN_GENAI_FILLS } from './nivo-theme';

interface GenaiEntry {
  intensity: string;
  count: number;
  percentage: number;
}

const LABELS: Record<string, string> = {
  core: 'Core',
  none: 'None',
  unclear: 'Unclear',
  tooling: 'Tooling',
  enhancement: 'Enhancement',
};

const FILLS: Record<string, string> = {
  core: 'hsl(40, 50%, 48%)',
  none: 'hsl(220, 20%, 40%)',
  unclear: 'hsl(220, 15%, 35%)',
  tooling: 'hsl(192, 50%, 45%)',
  enhancement: 'hsl(160, 35%, 42%)',
};

export function GenaiIntensity({ data, theme = 'dark' }: { data: GenaiEntry[]; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const colorMap = isLinkedin ? LINKEDIN_GENAI_FILLS : FILLS;
  const nivoTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;
  const chartData = data.map(d => ({
    ...d,
    label: LABELS[d.intensity] || d.intensity,
  } as Record<string, any>));

  return (
    <div className="w-full" style={{ height: 240 }}>
      <ResponsiveBar
        data={chartData}
        keys={['count']}
        indexBy="label"
        layout="horizontal"
        margin={{ top: 10, right: 20, bottom: 30, left: 100 }}
        padding={0.35}
        borderRadius={4}
        colors={({ data: d }) => colorMap[d.intensity as string] || 'hsl(220, 20%, 40%)'}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
        }}
        enableGridX={true}
        enableGridY={false}
        enableLabel={false}
        tooltip={({ data: d }) => (
          <div className="bg-card border border-border/40 px-3 py-2 rounded text-sm">
            <p className="text-foreground font-medium">{LABELS[d.intensity as string] || d.intensity}</p>
            <p className="text-muted-foreground">{d.count} companies ({d.percentage}%)</p>
          </div>
        )}
        animate={true}
        motionConfig="gentle"
        theme={nivoTheme}
      />
    </div>
  );
}

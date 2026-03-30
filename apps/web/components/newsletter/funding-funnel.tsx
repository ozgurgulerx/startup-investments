'use client';

import { ResponsiveBar } from '@nivo/bar';
import { NEWSLETTER_THEME, LINKEDIN_THEME, LINKEDIN_STAGE_FILLS } from './nivo-theme';

interface StageEntry {
  stage: string;
  rounds: number;
  rounds_pct: number;
  capital: number;
  capital_formatted: string;
}

const STAGE_FILLS = [
  'hsl(220, 25%, 50%)',
  'hsl(192, 50%, 45%)',
  'hsl(40, 50%, 48%)',
  'hsl(25, 45%, 48%)',
  'hsl(340, 30%, 48%)',
];

export function FundingFunnel({ data, theme = 'dark' }: { data: StageEntry[]; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const fills = isLinkedin ? LINKEDIN_STAGE_FILLS : STAGE_FILLS;
  const nivoTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;
  const barData = data.map(d => ({ ...d } as Record<string, any>));

  return (
    <div className="w-full" style={{ height: 280 }}>
      <ResponsiveBar
        data={barData}
        keys={['rounds']}
        indexBy="stage"
        layout="horizontal"
        margin={{ top: 10, right: 20, bottom: 30, left: 80 }}
        padding={0.35}
        borderRadius={4}
        colors={({ index }) => fills[index % fills.length]}
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
            <p className="text-foreground font-medium">{d.stage}</p>
            <p className="text-muted-foreground">{d.rounds} rounds ({d.rounds_pct}%)</p>
            <p className="text-muted-foreground">Capital: {d.capital_formatted}</p>
          </div>
        )}
        animate={true}
        motionConfig="gentle"
        theme={nivoTheme}
      />
    </div>
  );
}

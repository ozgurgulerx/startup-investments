'use client';

import { ResponsiveBar } from '@nivo/bar';
import { NEWSLETTER_THEME, LINKEDIN_THEME, LINKEDIN_GEO_FILLS } from './nivo-theme';

interface GeoEntry {
  region: string;
  companies: number;
  percentage: number;
}

const GEO_FILLS = [
  'hsl(192, 55%, 45%)',
  'hsl(260, 30%, 48%)',
  'hsl(40, 50%, 48%)',
  'hsl(220, 25%, 45%)',
  'hsl(160, 35%, 42%)',
];

export function GeographyChart({ data, theme = 'dark' }: { data: GeoEntry[]; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const fills = isLinkedin ? LINKEDIN_GEO_FILLS : GEO_FILLS;
  const nivoTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;
  const barData = data.map(d => ({ ...d } as Record<string, any>));

  return (
    <div className="w-full" style={{ height: 240 }}>
      <ResponsiveBar
        data={barData}
        keys={['companies']}
        indexBy="region"
        layout="horizontal"
        margin={{ top: 10, right: 20, bottom: 30, left: 110 }}
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
            <p className="text-foreground font-medium">{d.region}</p>
            <p className="text-muted-foreground">{d.companies} companies ({d.percentage}%)</p>
          </div>
        )}
        animate={true}
        motionConfig="gentle"
        theme={nivoTheme}
      />
    </div>
  );
}

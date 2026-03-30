'use client';

import { ResponsiveRadar } from '@nivo/radar';
import { NEWSLETTER_THEME, LINKEDIN_THEME } from './nivo-theme';

interface TrendEntry {
  pattern: string;
  count: number;
  total: number;
  percentage: number;
}

function shortLabel(name: string): string {
  return name
    .replace(' (Retrieval-Augmented Generation)', '')
    .replace('Continuous-learning ', 'Continuous ')
    .replace('Natural-Language-to-Code', 'NL-to-Code');
}

export function TrendRadar({ data, theme = 'dark' }: { data: TrendEntry[]; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const baseTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;
  const dotColor = isLinkedin ? 'hsl(192, 65%, 38%)' : 'hsl(192, 60%, 50%)';
  const lineColor = isLinkedin ? 'hsl(192, 65%, 38%)' : 'hsl(192, 60%, 50%)';
  const dotBorder = isLinkedin ? '#ffffff' : 'hsl(220, 18%, 10%)';
  const gridStroke = isLinkedin ? 'hsl(220, 15%, 85%)' : 'hsl(220, 15%, 25%)';
  const radarData = data.slice(0, 6).map(d => ({
    subject: shortLabel(d.pattern),
    percentage: d.percentage,
    fullName: d.pattern,
    count: d.count,
    total: d.total,
  }));

  return (
    <div className="w-full" style={{ height: 340 }}>
      <ResponsiveRadar
        data={radarData}
        keys={['percentage']}
        indexBy="subject"
        maxValue="auto"
        margin={{ top: 40, right: 60, bottom: 40, left: 60 }}
        gridShape="circular"
        gridLevels={4}
        gridLabelOffset={16}
        dotSize={8}
        dotColor={dotColor}
        dotBorderWidth={2}
        dotBorderColor={dotBorder}
        colors={[lineColor]}
        fillOpacity={isLinkedin ? 0.15 : 0.2}
        borderWidth={2}
        borderColor={lineColor}
        sliceTooltip={({ index, data: sliceData }) => {
          const item = sliceData[0];
          const original = radarData.find(d => d.subject === index);
          return (
            <div className="bg-card border border-border/40 px-3 py-2 rounded text-sm">
              <p className="text-foreground font-medium">{original?.fullName || index}</p>
              <p className="text-muted-foreground">
                {original?.count}/{original?.total} companies ({item.value}%)
              </p>
            </div>
          );
        }}
        animate={true}
        motionConfig="wobbly"
        theme={{
          ...baseTheme,
          grid: { line: { stroke: gridStroke } },
        }}
      />
    </div>
  );
}

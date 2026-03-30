'use client';

import { ResponsiveSankey } from '@nivo/sankey';
import { NEWSLETTER_THEME, LINKEDIN_THEME, LINKEDIN_CATEGORY_FILLS } from './nivo-theme';

// Reuse stage colors from funding-funnel.tsx
const STAGE_COLORS: Record<string, string> = {
  'Pre-Seed': 'hsl(220, 25%, 50%)',
  'Seed': 'hsl(192, 50%, 45%)',
  'Series A': 'hsl(40, 50%, 48%)',
  'Series B': 'hsl(25, 45%, 48%)',
  'Series C+': 'hsl(340, 30%, 48%)',
};

const LINKEDIN_STAGE_COLORS: Record<string, string> = {
  'Pre-Seed': 'hsl(220, 35%, 45%)',
  'Seed': 'hsl(192, 60%, 40%)',
  'Series A': 'hsl(40, 60%, 45%)',
  'Series B': 'hsl(25, 55%, 44%)',
  'Series C+': 'hsl(340, 40%, 44%)',
};

// Reuse category colors from capital-treemap.tsx
const CATEGORY_COLORS: Record<string, string> = {
  'Generative AI / Foundation Models': 'hsl(40, 50%, 48%)',
  'Robotics & Physical AI': 'hsl(192, 55%, 42%)',
  'Enterprise SaaS + AI': 'hsl(220, 25%, 45%)',
  'AI Infrastructure': 'hsl(260, 30%, 48%)',
  'Fintech AI': 'hsl(160, 35%, 40%)',
  'Security AI': 'hsl(340, 25%, 45%)',
  'Healthcare AI': 'hsl(200, 35%, 45%)',
  'Agentic AI': 'hsl(25, 45%, 48%)',
};

interface SankeyFlow {
  flows: {
    source: string;
    target: string;
    value: number;
    value_formatted: string;
  }[];
}

function toNivoData(data: SankeyFlow, isLinkedin: boolean) {
  const sourceIds = new Set<string>();
  const targetIds = new Set<string>();
  const stageColors = isLinkedin ? LINKEDIN_STAGE_COLORS : STAGE_COLORS;
  const categoryColors = isLinkedin ? LINKEDIN_CATEGORY_FILLS : CATEGORY_COLORS;

  for (const f of data.flows) {
    sourceIds.add(f.source);
    targetIds.add(f.target);
  }

  const nodes = [
    ...Array.from(sourceIds).map(id => ({
      id,
      nodeColor: stageColors[id] || 'hsl(220, 20%, 40%)',
    })),
    ...Array.from(targetIds).map(id => ({
      id,
      nodeColor: categoryColors[id] || 'hsl(220, 20%, 40%)',
    })),
  ];

  const links = data.flows.map(f => ({
    source: f.source,
    target: f.target,
    value: f.value,
    value_formatted: f.value_formatted,
  }));

  return { nodes, links };
}

export function SankeyDiagram({ data, theme = 'dark' }: { data: SankeyFlow; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const nivoData = toNivoData(data, isLinkedin);
  const nivoTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;

  return (
    <div className="w-full" style={{ height: 420 }}>
      <ResponsiveSankey
        data={nivoData}
        margin={{ top: 10, right: 160, bottom: 10, left: 100 }}
        align="justify"
        colors={(node) => (node as any).nodeColor || 'hsl(220, 20%, 40%)'}
        nodeThickness={16}
        nodeSpacing={12}
        nodeBorderRadius={3}
        nodeOpacity={1}
        nodeBorderWidth={0}
        linkOpacity={0.4}
        linkHoverOpacity={0.7}
        linkContract={1}
        enableLinkGradient={true}
        labelPosition="outside"
        labelPadding={12}
        labelTextColor={isLinkedin ? 'hsl(220, 15%, 25%)' : 'hsl(30, 10%, 65%)'}
        animate={true}
        motionConfig="gentle"
        linkTooltip={({ link }) => (
          <div className="bg-card border border-border/40 px-3 py-2 rounded text-sm">
            <p className="text-foreground font-medium">
              {link.source.id} &rarr; {link.target.id}
            </p>
            <p className="text-muted-foreground">
              {(link as any).value_formatted || link.formattedValue}
            </p>
          </div>
        )}
        theme={nivoTheme}
      />
    </div>
  );
}

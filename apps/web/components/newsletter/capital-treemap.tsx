'use client';

import { ResponsiveTreeMap } from '@nivo/treemap';
import { NEWSLETTER_THEME, LINKEDIN_THEME, LINKEDIN_CATEGORY_FILLS } from './nivo-theme';

interface CapitalFlowEntry {
  category: string;
  rounds: number;
  total_funding: number;
  total_funding_formatted: string;
  avg_round_formatted: string;
}

const CATEGORY_FILLS: Record<string, string> = {
  'Generative AI / Foundation Models': 'hsl(40, 50%, 48%)',
  'Robotics & Physical AI': 'hsl(192, 55%, 42%)',
  'Enterprise SaaS + AI': 'hsl(220, 25%, 45%)',
  'AI Infrastructure': 'hsl(260, 30%, 48%)',
  'Fintech AI': 'hsl(160, 35%, 40%)',
  'Security AI': 'hsl(340, 25%, 45%)',
  'Healthcare AI': 'hsl(200, 35%, 45%)',
  'Agentic AI': 'hsl(25, 45%, 48%)',
};

export function CapitalTreemap({ data, theme = 'dark' }: { data: CapitalFlowEntry[]; theme?: 'dark' | 'linkedin' }) {
  const isLinkedin = theme === 'linkedin';
  const fills = isLinkedin ? LINKEDIN_CATEGORY_FILLS : CATEGORY_FILLS;
  const nivoTheme = isLinkedin ? LINKEDIN_THEME : NEWSLETTER_THEME;
  const treeData = {
    name: 'root',
    children: data.map(d => ({
      name: d.category,
      size: d.total_funding,
      total_funding_formatted: d.total_funding_formatted,
      rounds: d.rounds,
      avg_round_formatted: d.avg_round_formatted,
    })),
  };

  return (
    <div className="w-full" style={{ height: 320 }}>
      <ResponsiveTreeMap
        data={treeData}
        identity="name"
        value="size"
        tile="squarify"
        innerPadding={3}
        outerPadding={2}
        colors={(node) => fills[node.id as string] || 'hsl(220, 20%, 40%)'}
        borderWidth={2}
        borderColor={isLinkedin ? 'hsl(220, 15%, 92%)' : 'hsl(220, 18%, 10%)'}
        labelSkipSize={40}
        label={(node) => {
          const short = (node.id as string)
            .replace(' AI', '')
            .replace(' / Foundation Models', '');
          return short;
        }}
        labelTextColor={isLinkedin ? '#ffffff' : 'hsl(30, 10%, 90%)'}
        parentLabelTextColor={isLinkedin ? '#ffffff' : 'hsl(30, 10%, 90%)'}
        enableParentLabel={false}
        tooltip={({ node }) => {
          const d = node.data as any;
          return (
            <div className="bg-card border border-border/40 px-3 py-2 rounded text-sm">
              <p className="text-foreground font-medium">{node.id}</p>
              <p className="text-muted-foreground">
                {d.rounds} rounds &middot; {d.total_funding_formatted}
              </p>
              <p className="text-muted-foreground">Avg: {d.avg_round_formatted}</p>
            </div>
          );
        }}
        animate={true}
        motionConfig="gentle"
        theme={nivoTheme}
      />
    </div>
  );
}

// Server-side helper to generate highlights from stats
// This file intentionally does NOT have 'use client' so it can be used in server components

export type HighlightIcon = 'trending' | 'users' | 'globe' | 'default';

export interface HighlightData {
  icon: HighlightIcon;
  text: string;
}

export function generateHighlights(stats: {
  pattern_distribution?: Record<string, number>;
  top_deals?: Array<{ name: string; funding_usd: number }>;
  top_investors?: Array<{ name: string; deal_count: number }>;
  funding_by_continent?: Record<string, { count: number; total_usd: number }>;
}): HighlightData[] {
  const highlights: HighlightData[] = [];

  // Top pattern
  if (stats.pattern_distribution) {
    const patterns = Object.entries(stats.pattern_distribution);
    const topPattern = patterns.sort((a, b) => b[1] - a[1])[0];
    if (topPattern) {
      highlights.push({
        icon: 'trending',
        text: `${topPattern[0]} leads with ${topPattern[1]} startups`,
      });
    }
  }

  // Top investor
  if (stats.top_investors?.[0]) {
    highlights.push({
      icon: 'users',
      text: `${stats.top_investors[0].name} most active with ${stats.top_investors[0].deal_count} deals`,
    });
  }

  // Geographic insight
  if (stats.funding_by_continent) {
    const continents = Object.entries(stats.funding_by_continent);
    const nonUS = continents
      .filter(([name]) => name !== 'north_america')
      .sort((a, b) => b[1].total_usd - a[1].total_usd)[0];
    if (nonUS) {
      const percentage = (
        (nonUS[1].total_usd /
          continents.reduce((sum, [, v]) => sum + v.total_usd, 0)) *
        100
      ).toFixed(1);
      highlights.push({
        icon: 'globe',
        text: `${nonUS[0].replace(/_/g, ' ')} captured ${percentage}% of funding`,
      });
    }
  }

  return highlights;
}

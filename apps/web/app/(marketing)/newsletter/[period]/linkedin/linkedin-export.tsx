'use client';

import {
  CapitalTreemap,
  TrendRadar,
  FundingFunnel,
  SankeyDiagram,
  GeographyChart,
  GenaiIntensity,
} from '@/components/newsletter';

interface NewsletterData {
  period: string;
  hero: {
    total_funding_formatted: string;
    total_rounds: number;
    median_round_formatted: string;
    avg_round_formatted: string;
  };
  capital_flow: any[];
  big5: {
    company: string;
    amount: number;
    amount_formatted: string;
    stage: string;
    description: string;
  }[];
  top5_concentration: {
    top5_total_formatted: string;
    remaining_total_formatted: string;
    remaining_count: number;
  };
  trend_radar: any[];
  stage_snapshot: any[];
  sankey_flow: { flows: { source: string; target: string; value: number; value_formatted: string }[] };
  geography: any[];
  genai_intensity: any[];
  meta: {
    total_rounds: number;
    total_analyzed: number;
    period_label: string;
  };
}

const STAGE_BAR_COLORS: Record<string, string> = {
  'Pre-Seed': 'hsl(220, 35%, 45%)',
  'Seed': 'hsl(192, 60%, 40%)',
  'Series A': 'hsl(40, 60%, 45%)',
  'Series B': 'hsl(25, 55%, 44%)',
  'Series C+': 'hsl(340, 40%, 44%)',
};

function Watermark() {
  return (
    <p className="text-sm text-gray-400 mt-3 text-right">BuildAtlas</p>
  );
}

function Big5Bar({ data }: { data: NewsletterData['big5'] }) {
  const maxAmount = data[0]?.amount || 1;
  return (
    <div className="space-y-3">
      {data.map((company, i) => {
        const widthPct = Math.max((company.amount / maxAmount) * 100, 3);
        return (
          <div key={i} className="flex items-center gap-4">
            <div className="w-32 shrink-0">
              <p className="text-sm text-gray-900 font-medium truncate">{company.company}</p>
              <p className="text-xs text-gray-500">{company.stage}</p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 h-7 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${widthPct}%`,
                    background: STAGE_BAR_COLORS[company.stage] || 'hsl(40, 60%, 45%)',
                  }}
                />
              </div>
              <span className="text-sm font-semibold text-gray-900 shrink-0 w-20 text-right">
                {company.amount_formatted}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LinkedInExport({ data }: { data: NewsletterData }) {
  return (
    <div className="bg-gray-100 min-h-screen py-12 px-4">
      <div className="mx-auto" style={{ maxWidth: 1200 }}>
        <p className="text-center text-sm text-gray-500 mb-8">
          LinkedIn Export — screenshot each section below
        </p>

        {/* Cover Image — 1920×1080 */}
        <section
          data-chart="cover"
          className="bg-white rounded-lg mb-10 flex flex-col items-center justify-center"
          style={{ width: 1920, height: 1080, padding: 80 }}
        >
          <p className="text-lg font-medium text-gray-400 uppercase tracking-widest mb-4">
            BuildAtlas
          </p>
          <h1 className="text-6xl font-light text-gray-900 text-center leading-tight mb-6">
            {data.hero.total_funding_formatted} deployed across<br />
            {data.hero.total_rounds} AI rounds
          </h1>
          <p className="text-2xl text-gray-500 text-center max-w-3xl mb-12">
            {data.meta.period_label} — AI Funding Landscape Report
          </p>
          <div className="flex gap-16">
            <div className="text-center">
              <p className="text-sm text-gray-400 uppercase tracking-wide">Median Round</p>
              <p className="text-4xl font-light text-gray-900 mt-1">{data.hero.median_round_formatted}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-400 uppercase tracking-wide">Average Round</p>
              <p className="text-4xl font-light text-gray-900 mt-1">{data.hero.avg_round_formatted}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-400 uppercase tracking-wide">Companies Analyzed</p>
              <p className="text-4xl font-light text-gray-900 mt-1">{data.meta.total_analyzed}</p>
            </div>
          </div>
        </section>

        {/* 1. Capital Treemap */}
        <section data-chart="capital-treemap" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Capital Flow</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-4">Where the Money Went</h3>
          <div style={{ height: 400 }}>
            <CapitalTreemap data={data.capital_flow} theme="linkedin" />
          </div>
          <Watermark />
        </section>

        {/* 2. Big 5 Bar */}
        <section data-chart="big5-bar" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">The Big 5</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-2">Rounds That Shaped the Month</h3>
          <p className="text-sm text-gray-500 mb-4">
            Top 5 = {data.top5_concentration.top5_total_formatted}. The remaining {data.top5_concentration.remaining_count} companies raised {data.top5_concentration.remaining_total_formatted}.
          </p>
          <Big5Bar data={data.big5} />
          <Watermark />
        </section>

        {/* 3. Trend Radar */}
        <section data-chart="trend-radar" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Trend Radar</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-4">Patterns Defining the Month</h3>
          <div style={{ height: 400 }}>
            <TrendRadar data={data.trend_radar} theme="linkedin" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-2">
            {data.trend_radar.slice(0, 6).map((t: any, i: number) => (
              <div key={i} className="flex items-baseline gap-2 py-1 border-b border-gray-200">
                <span className="text-sm font-semibold text-gray-900">{t.percentage}%</span>
                <span className="text-sm text-gray-600">{t.pattern}</span>
              </div>
            ))}
          </div>
          <Watermark />
        </section>

        {/* 4. Funding Funnel */}
        <section data-chart="funding-funnel" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Funding Funnel</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-4">The Stage Snapshot</h3>
          <div style={{ height: 340 }}>
            <FundingFunnel data={data.stage_snapshot} theme="linkedin" />
          </div>
          <div className="mt-4 flex gap-4">
            {data.stage_snapshot.map((s: any, i: number) => (
              <div key={i} className="text-center flex-1 p-3 border border-gray-200 rounded">
                <p className="text-xs text-gray-500">{s.stage}</p>
                <p className="text-lg font-semibold text-gray-900">{s.rounds}</p>
                <p className="text-sm text-gray-500">{s.capital_formatted}</p>
              </div>
            ))}
          </div>
          <Watermark />
        </section>

        {/* 5. Sankey Diagram */}
        <section data-chart="sankey-diagram" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Capital Pathways</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-2">Where Each Stage Flows</h3>
          <p className="text-sm text-gray-500 mb-4">Band width proportional to capital deployed</p>
          <div style={{ height: 500 }}>
            <SankeyDiagram data={data.sankey_flow} theme="linkedin" />
          </div>
          <Watermark />
        </section>

        {/* 6. Geography Bar */}
        <section data-chart="geography-bar" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">Geography</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-4">Where AI Gets Built</h3>
          <div style={{ height: 300 }}>
            <GeographyChart data={data.geography} theme="linkedin" />
          </div>
          <Watermark />
        </section>

        {/* 7. GenAI Intensity */}
        <section data-chart="genai-intensity" className="bg-white p-8 rounded-lg mb-10" style={{ width: 1200 }}>
          <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">GenAI Depth</p>
          <h3 className="text-xl font-semibold text-gray-900 mt-1 mb-4">How Deep Does AI Go?</h3>
          <div style={{ height: 300 }}>
            <GenaiIntensity data={data.genai_intensity} theme="linkedin" />
          </div>
          <div className="mt-4 flex gap-4">
            {data.genai_intensity.map((g: any, i: number) => (
              <div key={i} className="text-center flex-1">
                <p className="text-lg font-semibold text-gray-900">{g.percentage}%</p>
                <p className="text-xs text-gray-500 capitalize">{g.intensity}</p>
              </div>
            ))}
          </div>
          <Watermark />
        </section>
      </div>
    </div>
  );
}

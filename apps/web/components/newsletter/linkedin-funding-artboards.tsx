'use client';

import Link from 'next/link';
import { ResponsiveSankey } from '@nivo/sankey';
import { ResponsiveTreeMap } from '@nivo/treemap';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  FundingDealRow,
  FundingStageRow,
  LinkedinAssetSlug,
  LinkedinFundingPackData,
} from '@/lib/linkedin-funding-pack';
import {
  LINKEDIN_ASSETS,
  chartThemeColor,
  formatPercent,
  formatUsdCompact,
  hexToRgba,
  stageColor,
} from '@/lib/linkedin-funding-pack';

const NIVO_LIGHT_THEME = {
  text: { fontSize: 12, fill: '#334155' },
  axis: {
    ticks: { text: { fill: '#475569', fontSize: 11 } },
    legend: { text: { fill: '#0F172A', fontSize: 12 } },
  },
  grid: { line: { stroke: '#E2E8F0' } },
  tooltip: {
    container: {
      background: '#FFFFFF',
      border: '1px solid #E2E8F0',
      color: '#0F172A',
      fontSize: 12,
      borderRadius: 16,
      padding: '8px 10px',
      boxShadow: '0 18px 50px rgba(15, 23, 42, 0.10)',
    },
  },
};

const COUNTRY_COLORS: Record<string, string> = {
  'United States': '#0F172A',
  'United Kingdom': '#334155',
  China: '#475569',
  France: '#64748B',
  Sweden: '#94A3B8',
  Switzerland: '#CBD5E1',
  'Other Geographies': '#E2E8F0',
};

function isValidAsset(value?: string): value is LinkedinAssetSlug {
  return value === 'all' || LINKEDIN_ASSETS.some((asset) => asset.slug === value);
}

function fundingTooltipLabel(deal: FundingDealRow): string {
  return `${deal.company} · ${formatUsdCompact(deal.capitalUsd)}`;
}

function eyebrow(text: string) {
  return (
    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
      <span className="h-2 w-2 rounded-full bg-[#2457FF]" />
      {text}
    </div>
  );
}

function MetaBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
        {value}
      </div>
    </div>
  );
}

function BoardHeader({
  label,
  title,
  note,
}: {
  label: string;
  title: string;
  note?: string;
}) {
  return (
    <div>
      {eyebrow(label)}
      <h2 className="text-[1.9rem] font-semibold leading-[1.02] tracking-[-0.045em] text-slate-950">
        {title}
      </h2>
      {note ? (
        <div className="mt-3 max-w-[38rem] text-[0.95rem] leading-relaxed text-slate-600">
          {note}
        </div>
      ) : null}
    </div>
  );
}

function shortLabel(label: string, max = 24) {
  if (label.length <= max) {
    return label;
  }
  return `${label.slice(0, max - 1)}…`;
}

function themeDisplayLabel(label: string) {
  return label
    .replace('Health + Life Sciences', 'Health + Life')
    .replace('AI Infrastructure', 'AI Infra')
    .replace('AI Dev Tools', 'AI Dev')
    .replace('Predictive Markets', 'Prediction Mkt')
    .replace('Climate + Sustainability', 'Climate');
}

function buildConicGradient(stages: LinkedinFundingPackData['stages']) {
  let cursor = 0;
  const segments = stages
    .filter((stage) => stage.capitalSharePct > 0)
    .map((stage) => {
      const start = cursor;
      cursor += stage.capitalSharePct;
      return `${stageColor(stage.stage)} ${start}% ${cursor}%`;
    });
  return `conic-gradient(${segments.join(', ')})`;
}

function rangeLabel(min: number, max: number) {
  return `${formatUsdCompact(min)} to ${formatUsdCompact(max)}`;
}

function ArtboardShell({
  id,
  children,
  aspect,
}: {
  id: string;
  children: React.ReactNode;
  aspect?: string;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-[1400px] p-4">
      <div
        className={`relative overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_35px_80px_rgba(15,23,42,0.10)] ${aspect ?? 'aspect-[14/9]'}`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.07)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="absolute -left-20 top-[-72px] h-72 w-72 rounded-full bg-[#2457FF]/10 blur-3xl" />
        <div className="absolute bottom-[-96px] right-[-40px] h-80 w-80 rounded-full bg-[#F36A2D]/10 blur-3xl" />
        <div className="absolute left-[42%] top-[14%] h-64 w-64 rounded-full bg-[#0E8F7A]/8 blur-3xl" />
        <div className="relative h-full">{children}</div>
      </div>
    </section>
  );
}

function HeroTreemap({ data }: { data: LinkedinFundingPackData }) {
  const topThemeRows = data.themes.slice(0, 6);
  const leadDeals = data.topDeals.slice(0, 5);

  return (
    <ArtboardShell id="artboard-hero">
      <div className="grid h-full grid-cols-12 gap-10 px-10 py-10">
        <div className="col-span-5 flex flex-col">
          {eyebrow('LinkedIn Newsletter Hero')}
          <div className="max-w-[30rem]">
            <div className="text-[13px] font-semibold uppercase tracking-[0.28em] text-slate-500">
              March 2026 AI funding
            </div>
            <h1 className="mt-4 text-[5.2rem] font-semibold leading-[0.92] tracking-[-0.08em] text-slate-950">
              {formatUsdCompact(data.summary.totalFundingUsd)}
            </h1>
            <p className="mt-3 max-w-[24rem] text-[1rem] leading-relaxed text-slate-600">
              A concentrated month shaped by frontier, infrastructure, robotics,
              and defense.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <MetaBadge label="Rounds" value={`${data.summary.roundCount}`} />
            <MetaBadge label="Median Round" value={formatUsdCompact(data.summary.medianRoundUsd)} />
            <MetaBadge label="Top 5 Share" value={formatPercent(data.summary.top5CapitalSharePct)} />
            <MetaBadge label="Seed Count" value={`${data.summary.seedRoundCount}`} />
          </div>

          <div className="mt-8 rounded-[28px] border border-slate-200 bg-white/80 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Biggest rounds
            </div>
            <div className="mt-4 space-y-3">
              {leadDeals.map((deal, index) => (
                <div key={deal.name} className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">
                      {deal.company}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {deal.theme}
                      {deal.subtheme ? ` · ${deal.subtheme}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-slate-950">
                      {formatUsdCompact(deal.capitalUsd)}
                    </div>
                    <div className="text-sm text-slate-500">{deal.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-7 flex h-full flex-col">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Capital map
              </div>
              <div className="mt-2 max-w-[34rem] text-sm leading-relaxed text-slate-600">
                Frontier Lab alone captured {formatUsdCompact(data.summary.leadingThemeFundingUsd)}.
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {topThemeRows.map((theme) => (
                <div
                  key={theme.name}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                    style={{ backgroundColor: chartThemeColor(theme.name) }}
                  />
                  {theme.name}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 min-h-0 flex-1 rounded-[28px] border border-slate-200 bg-white/80 p-4">
            <ResponsiveTreeMap
              data={data.heroTreemap as any}
              identity="name"
              value="size"
              margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
              innerPadding={3}
              outerPadding={2}
              tile="squarify"
              leavesOnly={false}
              colors={(node) => {
                const parentId = String((node as any).parent?.id || 'Other Themes');
                const color = (node.data as { color?: string; theme?: string }).color
                  || chartThemeColor((node.data as { theme?: string }).theme || parentId);
                return color;
              }}
              borderWidth={2}
              borderColor="#FFFFFF"
              enableParentLabel={true}
              parentLabelTextColor="#FFFFFF"
              labelSkipSize={28}
              labelTextColor="#FFFFFF"
              label={(node) => {
                if ((node as any).depth === 1) {
                  return `${node.id}`;
                }
                return String(node.id);
              }}
              theme={NIVO_LIGHT_THEME}
              tooltip={({ node }) => (
                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-xl">
                  <div className="font-semibold text-slate-950">{node.id}</div>
                  {'size' in node.data && typeof (node.data as { size?: number }).size === 'number' ? (
                    <div>{formatUsdCompact((node.data as { size: number }).size)}</div>
                  ) : null}
                </div>
              )}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-400">
            <span>Source: {data.meta.sourceWorkbook}</span>
            <span>White-background export built for LinkedIn inline newsletter use</span>
          </div>
        </div>
      </div>
    </ArtboardShell>
  );
}

function DealLadderBoard({ data }: { data: LinkedinFundingPackData }) {
  const deals = data.topDeals.slice(0, 12);
  const maxCapital = deals[0]?.capitalUsd || 1;
  const stageLegend = data.stages.filter((stage) => stage.capitalUsd > 0);
  const donutGradient = buildConicGradient(stageLegend);

  return (
    <ArtboardShell id="artboard-deal-ladder">
      <div className="grid h-full grid-cols-12 gap-8 px-10 py-10">
        <div className="col-span-7 flex flex-col">
          <BoardHeader
            label="Deal Ladder"
            title="Top Rounds"
            note="Ranked rounds on the left, stage mix on the right."
          />

          <div className="mt-6 flex-1 rounded-[28px] border border-slate-200 bg-white/85 p-5">
            <div className="mb-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              <span>Top rounds by capital raised</span>
              <span>{deals.length} rounds shown</span>
            </div>
            <div className="space-y-3.5">
              {deals.map((deal, index) => {
                const width = `${(deal.capitalUsd / maxCapital) * 100}%`;
                const barColor = chartThemeColor(deal.theme);

                return (
                  <div key={deal.name} className="grid grid-cols-[170px_1fr_92px] items-center gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div className="truncate text-sm font-semibold text-slate-950">
                        {deal.company}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {themeDisplayLabel(deal.theme)}
                        {deal.subtheme ? ` · ${deal.subtheme}` : ''}
                      </div>
                    </div>

                    <div className="relative h-7 rounded-full bg-slate-100">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width,
                          background: `linear-gradient(90deg, ${hexToRgba(barColor, 0.95)}, ${hexToRgba(barColor, 0.68)})`,
                        }}
                      />
                    </div>

                    <div className="text-right text-sm font-semibold text-slate-950">
                      {formatUsdCompact(deal.capitalUsd)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col-span-5 flex flex-col">
          <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Stage mix
            </div>

            <div className="mt-6 flex items-center justify-center">
              <div
                className="relative h-72 w-72 rounded-full"
                style={{ background: donutGradient }}
              >
                <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(226,232,240,1)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Total
                  </div>
                  <div className="mt-2 text-4xl font-semibold tracking-[-0.06em] text-slate-950">
                    {formatUsdCompact(data.summary.totalFundingUsd)}
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {data.summary.roundCount} rounds
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-2.5">
              {stageLegend.map((stage) => (
                <div key={stage.stage} className="flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: stageColor(stage.stage) }}
                    />
                    <span className="font-medium text-slate-800">{stage.stage}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-950">
                      {formatPercent(stage.capitalSharePct)}
                    </div>
                    <div className="text-xs text-slate-500">{formatUsdCompact(stage.capitalUsd)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Read
            </div>
            <div className="mt-3 text-[0.95rem] leading-relaxed text-slate-700">
              Lots of early-stage activity, but a narrow set of larger rounds
              still dominated the capital outcome.
            </div>
          </div>
        </div>
      </div>
    </ArtboardShell>
  );
}

function StageTensionBoard({ data }: { data: LinkedinFundingPackData }) {
  const maxRounds = Math.max(...data.stages.map((stage) => stage.rounds));
  const maxCapital = Math.max(...data.stages.map((stage) => stage.capitalUsd));
  const spotlight = [
    data.stages.find((stage) => stage.stage === 'Seed'),
    data.stages.find((stage) => stage.stage === 'Venture / Unknown'),
    data.stages.find((stage) => stage.stage === 'Series A'),
  ].filter(Boolean) as FundingStageRow[];

  return (
    <ArtboardShell id="artboard-stage-tension">
      <div className="flex h-full flex-col px-12 py-10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8">
            <BoardHeader
              label="Stage Tension"
              title="Counts vs Capital"
              note="Stage counts on the left, capital share on the right."
            />
          </div>
          <div className="col-span-4 pt-5 text-sm leading-relaxed text-slate-600">
            A compact read on the mismatch between round volume and capital
            concentration.
          </div>
        </div>

        <div className="mt-7 grid flex-1 grid-cols-[1fr_auto_1fr] gap-x-6">
          <div className="flex items-end pl-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Deal count
          </div>
          <div />
          <div className="flex items-end pr-3 text-right text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Capital deployed
          </div>

          <div className="col-span-3 mt-3 space-y-5">
            {data.stages.map((stage) => {
              const color = stageColor(stage.stage);
              const roundWidth = `${(stage.rounds / maxRounds) * 100}%`;
              const capitalWidth = `${(stage.capitalUsd / maxCapital) * 100}%`;

              return (
                <div
                  key={stage.stage}
                  className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-6"
                >
                  <div className="flex items-center justify-end gap-4">
                    <div className="text-right">
                      <div className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                        {stage.rounds}
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {formatPercent(stage.roundSharePct)}
                      </div>
                    </div>
                    <div className="h-4 w-full rounded-full bg-slate-100">
                      <div
                        className="h-4 rounded-full"
                        style={{
                          width: roundWidth,
                          backgroundColor: color,
                          marginLeft: 'auto',
                        }}
                      />
                    </div>
                  </div>

                  <div className="min-w-[160px] text-center">
                    <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900">
                      {stage.stage}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="h-4 w-full rounded-full bg-slate-100">
                      <div
                        className="h-4 rounded-full"
                        style={{
                          width: capitalWidth,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <div>
                      <div className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
                        {formatUsdCompact(stage.capitalUsd)}
                      </div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {formatPercent(stage.capitalSharePct)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          {spotlight.map((stage) => (
            <div key={stage.stage} className="rounded-[24px] border border-slate-200 bg-white/85 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {stage.stage}
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                {formatUsdCompact(stage.capitalUsd)}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-slate-600">
                {stage.rounds} rounds, {formatPercent(stage.capitalSharePct)} of all
                capital, average round {formatUsdCompact(stage.avgRoundUsd)}.
              </div>
            </div>
          ))}
        </div>
      </div>
    </ArtboardShell>
  );
}

function MarketMapBoard({ data }: { data: LinkedinFundingPackData }) {
  const points = data.themes
    .filter((theme) => theme.name !== 'Untagged')
    .slice(0, 10)
    .map((theme) => ({
      ...theme,
      avgRoundUsd: theme.capitalUsd / Math.max(theme.rounds, 1),
    }));
  const xValues = points.map((point) => point.avgRoundUsd);
  const yValues = points.map((point) => point.rounds);
  const maxCapital = Math.max(...points.map((point) => point.capitalUsd), 1);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const highestBreadth = [...points].sort((a, b) => b.rounds - a.rounds)[0];
  const highestIntensity = [...points].sort((a, b) => b.avgRoundUsd - a.avgRoundUsd)[0];

  return (
    <ArtboardShell id="artboard-market-map">
      <div className="grid h-full grid-cols-12 gap-8 px-10 py-10">
        <div className="col-span-8 flex flex-col">
          <BoardHeader
            label="Market Map"
            title="Theme Map"
            note="Round count vs average round size. Bubble size is total capital."
          />

          <div className="mt-6 flex-1 rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="relative h-full rounded-[24px] border border-slate-200 bg-[linear-gradient(to_right,rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.14)_1px,transparent_1px)] bg-[size:16.666%_20%]">
              <div className="absolute left-4 top-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                More rounds
              </div>
              <div className="absolute bottom-4 left-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Lower average round
              </div>
              <div className="absolute bottom-4 right-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Higher average round
              </div>

              {points.map((point) => {
                const x =
                  12 + ((point.avgRoundUsd - minX) / Math.max(maxX - minX, 1)) * 76;
                const y =
                  84 - ((point.rounds - minY) / Math.max(maxY - minY, 1)) * 64;
                const size = 34 + Math.sqrt(point.capitalUsd / maxCapital) * 88;

                return (
                  <div
                    key={point.name}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <div className="flex flex-col items-center">
                      <div
                        className="flex items-center justify-center rounded-full border shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                        style={{
                          width: size,
                          height: size,
                          backgroundColor: hexToRgba(chartThemeColor(point.name), 0.18),
                          borderColor: hexToRgba(chartThemeColor(point.name), 0.42),
                        }}
                      >
                        <div
                          className="rounded-full"
                          style={{
                            width: size * 0.52,
                            height: size * 0.52,
                            backgroundColor: hexToRgba(chartThemeColor(point.name), 0.86),
                          }}
                        />
                      </div>
                      <div className="mt-2 max-w-[120px] text-center text-xs font-semibold leading-tight text-slate-900">
                        {themeDisplayLabel(point.name)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {formatUsdCompact(point.capitalUsd)} · {point.rounds} rounds
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col-span-4 flex flex-col">
          <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Axis read
            </div>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Highest breadth
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                  {highestBreadth ? themeDisplayLabel(highestBreadth.name) : '—'}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {highestBreadth?.rounds ?? 0} rounds across the month
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  Highest intensity
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                  {highestIntensity ? themeDisplayLabel(highestIntensity.name) : '—'}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Avg. round size {highestIntensity ? formatUsdCompact(highestIntensity.avgRoundUsd) : '—'}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  X range
                </div>
                <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                  {rangeLabel(minX, maxX)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Interpretation
            </div>
            <div className="mt-3 text-[0.95rem] leading-relaxed text-slate-700">
              Upper-right themes combined volume and pricing power. Rightward but
              lower points were larger, more concentrated bets.
            </div>
          </div>
        </div>
      </div>
    </ArtboardShell>
  );
}

function CapitalFlowBoard({ data }: { data: LinkedinFundingPackData }) {
  const sankeyData = {
    nodes: data.capitalFlow.nodes.map((node) => ({
      id: node.id,
      nodeColor:
        node.kind === 'theme'
          ? chartThemeColor(node.id)
          : node.kind === 'stage'
            ? stageColor(node.id)
            : COUNTRY_COLORS[node.id] || COUNTRY_COLORS['Other Geographies'],
    })),
    links: data.capitalFlow.links,
  };

  return (
    <ArtboardShell id="artboard-capital-flow" aspect="aspect-[14/10]">
      <div className="flex h-full flex-col px-10 py-10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8">
            <BoardHeader
              label="Capital Flow"
              title="Country → Theme → Stage"
              note="How the month’s money moved through the market."
            />
          </div>
          <div className="col-span-4 pt-5 text-sm leading-relaxed text-slate-600">
            A flow view of geographic concentration and where it resolved.
          </div>
        </div>

        <div className="mt-6 flex-1 rounded-[28px] border border-slate-200 bg-white/80 p-4">
          <ResponsiveSankey
            data={sankeyData as any}
            margin={{ top: 24, right: 140, bottom: 24, left: 120 }}
            align="justify"
            colors={(node) => (node as { nodeColor?: string }).nodeColor || '#94A3B8'}
            nodeThickness={18}
            nodeSpacing={14}
            nodeBorderRadius={6}
            nodeBorderWidth={0}
            nodeOpacity={1}
            labelPosition="outside"
            labelPadding={14}
            labelTextColor="#334155"
            linkOpacity={0.28}
            linkHoverOpacity={0.55}
            linkContract={2}
            enableLinkGradient={true}
            theme={NIVO_LIGHT_THEME}
            linkTooltip={({ link }: { link: any }) => (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-xl">
                <div className="font-semibold text-slate-950">
                  {link.source.id} → {link.target.id}
                </div>
                <div className="text-slate-600">{formatUsdCompact(link.value as number)}</div>
              </div>
            )}
          />
        </div>
      </div>
    </ArtboardShell>
  );
}

function DailyPulseBoard({ data }: { data: LinkedinFundingPackData }) {
  const peakDays = data.dailyPeaks.slice(0, 4);

  return (
    <ArtboardShell id="artboard-daily-pulse">
      <div className="grid h-full grid-cols-12 gap-8 px-10 py-10">
        <div className="col-span-8 flex flex-col">
          <BoardHeader
            label="Daily Pulse"
            title="Daily Activity"
            note={`Daily capital totals with round-count bars. Peak day: ${data.summary.topFundingDay?.dayLabel}.`}
          />

          <div className="mt-6 min-h-0 flex-1 rounded-[28px] border border-slate-200 bg-white/80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.daily} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                <defs>
                  <linearGradient id="pulseGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#2457FF" stopOpacity={0.36} />
                    <stop offset="100%" stopColor="#2457FF" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 8" vertical={false} stroke="#E2E8F0" />
                <XAxis
                  dataKey="dayLabel"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tick={{ fill: '#475569', fontSize: 11 }}
                />
                <YAxis
                  yAxisId="capital"
                  orientation="left"
                  tickFormatter={(value: number) => formatUsdCompact(value, 0)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#475569', fontSize: 11 }}
                  width={72}
                />
                <YAxis
                  yAxisId="rounds"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#94A3B8', fontSize: 11 }}
                  width={36}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) {
                      return null;
                    }
                    const item = payload[0].payload as {
                      dayLabel: string;
                      rounds: number;
                      capitalUsd: number;
                    };
                    return (
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-xl">
                        <div className="font-semibold text-slate-950">{item.dayLabel}</div>
                        <div className="text-slate-600">
                          {formatUsdCompact(item.capitalUsd)} across {item.rounds} rounds
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine
                  yAxisId="capital"
                  y={data.summary.topFundingDay?.capitalUsd}
                  stroke="#CBD5E1"
                  strokeDasharray="4 8"
                />
                <Bar
                  yAxisId="rounds"
                  dataKey="rounds"
                  fill="#CBD5E1"
                  radius={[8, 8, 0, 0]}
                  maxBarSize={18}
                />
                <Area
                  yAxisId="capital"
                  type="monotone"
                  dataKey="capitalUsd"
                  stroke="#2457FF"
                  strokeWidth={3}
                  fill="url(#pulseGradient)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-4 flex flex-col">
          <div className="rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Peak days
            </div>
            <div className="mt-5 space-y-4">
              {peakDays.map((day, index) => (
                <div key={day.date} className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="text-sm text-slate-500">{day.dayLabel}</div>
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                    {formatUsdCompact(day.capitalUsd)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {day.rounds} rounds announced that day
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Editorial read
            </div>
            <div className="mt-3 text-[0.95rem] leading-relaxed text-slate-700">
              The market stayed active all month, but a few dates defined the
              capital narrative.
            </div>
          </div>
        </div>
      </div>
    </ArtboardShell>
  );
}

function ThemeMatrixBoard({ data }: { data: LinkedinFundingPackData }) {
  const maxCapital = data.themeStageMatrix.maxCapitalUsd || 1;

  return (
    <ArtboardShell id="artboard-theme-matrix">
      <div className="flex h-full flex-col px-10 py-10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-8">
            <BoardHeader
              label="Theme Matrix"
              title="Theme × Stage"
              note="Cell intensity is capital. The small numeral is round count."
            />
          </div>
          <div className="col-span-4 pt-4 text-sm leading-relaxed text-slate-600">
            A compact matrix of how each theme distributed across stages.
          </div>
        </div>

        <div className="mt-6 grid flex-1 grid-cols-[240px_repeat(7,minmax(0,1fr))] gap-3">
          <div />
          {data.themeStageMatrix.stages.map((stage) => (
            <div
              key={stage}
              className="flex items-end justify-center rounded-2xl border border-slate-200 bg-white/80 px-2 py-3 text-center text-sm font-semibold text-slate-700"
            >
              {stage}
            </div>
          ))}

          {data.themeStageMatrix.rows.map((row) => (
            <div key={row.theme} className="contents">
              <div className="rounded-[24px] border border-slate-200 bg-white/85 px-5 py-5">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <div className="text-lg font-semibold tracking-tight text-slate-950">
                    {row.theme}
                  </div>
                </div>
                <div className="mt-3 text-sm leading-relaxed text-slate-600">
                  {formatUsdCompact(row.cells.reduce((sum, cell) => sum + cell.capitalUsd, 0))} across{' '}
                  {row.cells.reduce((sum, cell) => sum + cell.rounds, 0)} tagged rounds
                </div>
              </div>

              {row.cells.map((cell) => {
                const intensity = cell.capitalUsd / maxCapital;
                const background = hexToRgba(row.color, 0.08 + intensity * 0.84);
                const textColor = intensity > 0.42 ? '#FFFFFF' : '#0F172A';
                const subColor = intensity > 0.42 ? 'rgba(255,255,255,0.82)' : '#475569';

                return (
                  <div
                    key={`${row.theme}-${cell.stage}`}
                    className="rounded-[24px] border border-slate-200 px-4 py-4"
                    style={{ background }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: subColor }}>
                      {cell.rounds} rounds
                    </div>
                    <div className="mt-3 text-2xl font-semibold tracking-[-0.05em]" style={{ color: textColor }}>
                      {cell.capitalUsd > 0 ? formatUsdCompact(cell.capitalUsd) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </ArtboardShell>
  );
}

function ThemeRankBoard({ data }: { data: LinkedinFundingPackData }) {
  const themes = data.themes.filter((theme) => theme.name !== 'Untagged').slice(0, 12);
  const subthemes = data.subthemes.slice(0, 10);
  const maxThemeCapital = themes[0]?.capitalUsd || 1;
  const maxSubthemeCapital = subthemes[0]?.capitalUsd || 1;

  return (
    <ArtboardShell id="artboard-theme-rank">
      <div className="grid h-full grid-cols-12 gap-8 px-10 py-10">
        <div className="col-span-6 flex flex-col">
          <BoardHeader
            label="Theme Rank"
            title="Theme Rankings"
            note="Top themes by capital raised."
          />

          <div className="mt-6 flex-1 rounded-[28px] border border-slate-200 bg-white/85 p-5">
            <div className="space-y-3">
              {themes.map((theme, index) => (
                <div key={theme.name} className="grid grid-cols-[180px_1fr_88px] items-center gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="truncate text-sm font-semibold text-slate-950">
                      {themeDisplayLabel(theme.name)}
                    </div>
                  </div>
                  <div className="h-5 rounded-full bg-slate-100">
                    <div
                      className="h-5 rounded-full"
                      style={{
                        width: `${(theme.capitalUsd / maxThemeCapital) * 100}%`,
                        background: `linear-gradient(90deg, ${hexToRgba(theme.color, 0.92)}, ${hexToRgba(theme.color, 0.68)})`,
                      }}
                    />
                  </div>
                  <div className="text-right text-sm font-semibold text-slate-950">
                    {formatUsdCompact(theme.capitalUsd)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-6 flex flex-col">
          <div className="pt-[58px] text-sm leading-relaxed text-slate-600">
            Non-empty subthemes from your processed sheet, ranked by capital.
          </div>

          <div className="mt-8 flex-1 rounded-[28px] border border-slate-200 bg-white/85 p-5">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Specified subthemes by capital
            </div>
            <div className="space-y-3">
              {subthemes.map((subtheme, index) => (
                <div key={subtheme.name} className="grid grid-cols-[190px_1fr_88px] items-center gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className="truncate text-sm font-semibold text-slate-950">
                      {shortLabel(subtheme.name, 26)}
                    </div>
                  </div>
                  <div className="h-5 rounded-full bg-slate-100">
                    <div
                      className="h-5 rounded-full"
                      style={{
                        width: `${(subtheme.capitalUsd / maxSubthemeCapital) * 100}%`,
                        background: `linear-gradient(90deg, rgba(17,24,39,0.88), rgba(36,87,255,0.75))`,
                      }}
                    />
                  </div>
                  <div className="text-right text-sm font-semibold text-slate-950">
                    {formatUsdCompact(subtheme.capitalUsd)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-[28px] border border-slate-200 bg-white/85 p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Read
            </div>
            <div className="mt-3 text-[0.95rem] leading-relaxed text-slate-700">
              Useful when you want a more specific market read than the headline
              theme buckets alone.
            </div>
          </div>
        </div>
      </div>
    </ArtboardShell>
  );
}

export function LinkedinFundingArtboards({
  data,
  asset = 'all',
  displayClassName,
  serifClassName,
}: {
  data: LinkedinFundingPackData;
  asset?: string;
  displayClassName?: string;
  serifClassName?: string;
}) {
  const selectedAsset = isValidAsset(asset) ? asset : 'all';
  const singleMode = selectedAsset !== 'all';
  const rootPadding = singleMode ? 'px-0 py-0' : 'px-4 py-6 sm:px-6 lg:px-8';
  const rootWidth = singleMode ? 'max-w-[1480px]' : 'max-w-[1520px]';
  const pageMinHeight = singleMode ? '' : 'min-h-screen';

  return (
    <div
      className={`paper ${pageMinHeight} bg-[#F4F7FB] ${displayClassName ?? ''}`}
      style={{
        backgroundImage:
          'radial-gradient(circle at 12% -6%, rgba(36,87,255,0.08), transparent 28%), radial-gradient(circle at 92% 6%, rgba(243,106,45,0.08), transparent 26%)',
      }}
    >
      <div className={`mx-auto ${rootWidth} ${rootPadding}`}>
        {singleMode ? null : (
          <div className="mb-8 rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Build Atlas x LinkedIn Visual Pack
                </div>
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-slate-950">
                  {data.meta.periodLabel} AI funding artboards
                </h1>
                <p className={`mt-3 max-w-3xl text-base leading-relaxed text-slate-600 ${serifClassName ?? ''}`}>
                  White-background, export-ready editorial visuals built from your
                  processed workbook. Open an individual artboard to capture a clean
                  inline asset for the newsletter.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href="?asset=all"
                  className="rounded-full border border-slate-200 bg-slate-950 px-4 py-2 text-sm font-medium text-white"
                >
                  All
                </Link>
                {LINKEDIN_ASSETS.map((item) => (
                  <Link
                    key={item.slug}
                    href={`?asset=${item.slug}`}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <div id="artboard-collection" className="space-y-8">
          {(selectedAsset === 'all' || selectedAsset === 'hero') && (
            <HeroTreemap data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'deal-ladder') && (
            <DealLadderBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'stage-tension') && (
            <StageTensionBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'capital-flow') && (
            <CapitalFlowBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'market-map') && (
            <MarketMapBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'daily-pulse') && (
            <DailyPulseBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'theme-matrix') && (
            <ThemeMatrixBoard data={data} />
          )}
          {(selectedAsset === 'all' || selectedAsset === 'theme-rank') && (
            <ThemeRankBoard data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

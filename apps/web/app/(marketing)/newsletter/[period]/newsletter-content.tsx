'use client';

import {
  CapitalTreemap,
  TrendRadar,
  FundingFunnel,
  SankeyDiagram,
  GeographyChart,
  MarketDonut,
  GenaiIntensity,
  BuilderCards,
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
  vertical_dives: {
    category: string;
    company_count: number;
    total_funding_formatted: string;
    top_companies: { name: string; amount_formatted: string }[];
  }[];
  geography: any[];
  market_dna: any;
  genai_intensity: any[];
  playbook: any[];
  meta: {
    total_rounds: number;
    total_analyzed: number;
    period_label: string;
  };
}

function SectionHeader({ number, label, title }: { number: string; label: string; title: string }) {
  return (
    <div className="mb-6">
      <p className="label-xs text-accent-info">{number} &mdash; {label}</p>
      <h2 className="headline-md mt-1">{title}</h2>
    </div>
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
            <div className="w-28 shrink-0">
              <p className="body-sm text-foreground font-medium truncate">{company.company}</p>
              <p className="label-xs text-muted-foreground">{company.stage}</p>
            </div>
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 h-6 bg-muted/20 rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${widthPct}%`,
                    background: 'hsl(40, 50%, 48%)',
                  }}
                />
              </div>
              <span className="num-sm text-foreground shrink-0 w-16 text-right">
                {company.amount_formatted}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NewsletterContent({ data }: { data: NewsletterData }) {
  return (
    <div className="space-y-16">

      {/* Section 1: Hero */}
      <section>
        <p className="label-xs text-accent mb-2">{data.meta.period_label} AI Landscape</p>
        <h1 className="text-4xl sm:text-5xl font-light tracking-tight text-foreground leading-tight">
          {data.hero.total_funding_formatted} deployed across {data.hero.total_rounds} AI rounds
        </h1>
        <p className="body-lg mt-4 text-muted-foreground max-w-2xl">
          Physical AI and infrastructure dominate as capital concentrates at the extremes.
        </p>
        <div className="flex flex-wrap gap-6 mt-6 pt-4 border-t border-border/30">
          <div>
            <p className="label-xs text-muted-foreground">Median Round</p>
            <p className="num-lg text-foreground">{data.hero.median_round_formatted}</p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Average Round</p>
            <p className="num-lg text-foreground">{data.hero.avg_round_formatted}</p>
          </div>
          <div>
            <p className="label-xs text-muted-foreground">Companies Analyzed</p>
            <p className="num-lg text-foreground">{data.meta.total_analyzed}</p>
          </div>
        </div>
      </section>

      {/* Section 2: Capital Flow */}
      <section>
        <SectionHeader number="01" label="Capital Flow" title="Where the Money Went" />
        <CapitalTreemap data={data.capital_flow} />

        {/* Table fallback */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left label-xs text-muted-foreground py-2">Category</th>
                <th className="text-right label-xs text-muted-foreground py-2">Rounds</th>
                <th className="text-right label-xs text-muted-foreground py-2">Total</th>
                <th className="text-right label-xs text-muted-foreground py-2">Avg</th>
              </tr>
            </thead>
            <tbody>
              {data.capital_flow.map((cf: any, i: number) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-2 body-sm text-foreground">{cf.category}</td>
                  <td className="py-2 num-sm text-muted-foreground text-right">{cf.rounds}</td>
                  <td className="py-2 num-sm text-foreground text-right">{cf.total_funding_formatted}</td>
                  <td className="py-2 num-sm text-muted-foreground text-right">{cf.avg_round_formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 3: Big 5 */}
      <section>
        <SectionHeader number="02" label="The Big 5" title="Rounds That Shaped the Month" />
        <Big5Bar data={data.big5} />

        <div className="mt-6 p-4 border border-border/30 rounded-lg bg-card/30">
          <p className="body-sm text-muted-foreground">
            <span className="text-accent font-medium">Concentration insight:</span>{' '}
            Remove the top 5 rounds ({data.top5_concentration.top5_total_formatted}) and the
            remaining {data.top5_concentration.remaining_count} companies raised{' '}
            {data.top5_concentration.remaining_total_formatted} — still massive, but the concentration
            is staggering.
          </p>
        </div>
      </section>

      {/* Section 4: Trend Radar */}
      <section>
        <SectionHeader number="03" label="Trend Radar" title="Patterns Defining the Month" />
        <TrendRadar data={data.trend_radar} />

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.trend_radar.slice(0, 6).map((t: any, i: number) => (
            <div key={i} className="flex items-baseline gap-3 py-2 border-b border-border/20">
              <span className="num-sm text-accent shrink-0">{t.percentage}%</span>
              <span className="body-sm text-foreground">{t.pattern}</span>
              <span className="body-sm text-muted-foreground ml-auto">{t.count}/{t.total}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Section 5: Stage Snapshot */}
      <section>
        <SectionHeader number="04" label="Funding Funnel" title="The Stage Snapshot" />
        <FundingFunnel data={data.stage_snapshot} />

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {data.stage_snapshot.map((s: any, i: number) => (
            <div key={i} className="text-center p-3 border border-border/20 rounded">
              <p className="label-xs text-muted-foreground">{s.stage}</p>
              <p className="num-md text-foreground">{s.rounds}</p>
              <p className="body-sm text-muted-foreground">{s.capital_formatted}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 body-sm text-muted-foreground italic">
          Seed rounds are {data.stage_snapshot.find((s: any) => s.stage === 'Seed')?.rounds_pct}% of
          all deals but only{' '}
          {(() => {
            const seed = data.stage_snapshot.find((s: any) => s.stage === 'Seed');
            const total = data.stage_snapshot.reduce((sum: number, s: any) => sum + s.capital, 0);
            return seed && total ? ((seed.capital / total) * 100).toFixed(1) : '?';
          })()}
          % of capital. The barbell is real.
        </p>
      </section>

      {/* Section 4b: Capital Pathways (Sankey) */}
      <section>
        <SectionHeader number="04b" label="Capital Pathways" title="Where Each Stage Flows" />
        <SankeyDiagram data={data.sankey_flow} />
        <p className="mt-4 body-sm text-muted-foreground italic">
          Follow the money from funding stage to sector. Band width is proportional to capital deployed.
        </p>
      </section>

      {/* Section 6: Vertical Deep Dives */}
      <section>
        <SectionHeader number="05" label="Vertical Deep Dives" title="Sectors to Watch" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.vertical_dives.map((v, i) => (
            <div key={i} className="border border-border/30 rounded-lg p-5 bg-card/30">
              <p className="label-xs text-accent-info">{v.company_count} companies</p>
              <h3 className="headline-sm mt-1 mb-1">{v.category}</h3>
              <p className="num-sm text-muted-foreground mb-4">{v.total_funding_formatted}</p>
              <ul className="space-y-1.5">
                {v.top_companies.map((c, j) => (
                  <li key={j} className="flex justify-between items-baseline">
                    <span className="body-sm text-foreground">{c.name}</span>
                    <span className="num-sm text-muted-foreground">{c.amount_formatted}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Section 7: Geography */}
      <section>
        <SectionHeader number="06" label="Geography" title="Where AI Gets Built" />
        <GeographyChart data={data.geography} />
        <p className="mt-4 body-sm text-muted-foreground italic">
          Europe&apos;s {data.geography.find((g: any) => g.region === 'Europe')?.percentage}% share is
          quietly significant — driven by UK, France, and Nordic clusters.
        </p>
      </section>

      {/* Section 8: Market DNA */}
      <section>
        <SectionHeader number="07" label="Market DNA" title="Horizontal vs Vertical" />
        <MarketDonut data={data.market_dna} />
        <p className="mt-4 body-sm text-muted-foreground italic">
          The &ldquo;vertical AI&rdquo; thesis is real but still outnumbered. Horizontal platforms
          capture more capital; vertical players build stronger moats.
        </p>
      </section>

      {/* Section 9: GenAI Intensity */}
      <section>
        <SectionHeader number="08" label="GenAI Depth" title="How Deep Does AI Go?" />
        <GenaiIntensity data={data.genai_intensity} />
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {data.genai_intensity.map((g: any, i: number) => (
            <div key={i} className="text-center p-2">
              <p className="num-md text-foreground">{g.percentage}%</p>
              <p className="label-xs text-muted-foreground capitalize">{g.intensity}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 10: Builder's Playbook */}
      <section>
        <SectionHeader number="09" label="Builder&rsquo;s Playbook" title="3 Takeaways" />
        <BuilderCards data={data.playbook} />
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 pt-8 pb-4">
        <p className="body-sm text-muted-foreground text-center">
          Data from {data.meta.total_rounds} funding rounds, {data.meta.total_analyzed} deep
          analyses. {data.meta.period_label}.
        </p>
        <p className="body-sm text-muted-foreground text-center mt-1">
          BuildAtlas — AI market intelligence for builders and investors.
        </p>
      </footer>
    </div>
  );
}

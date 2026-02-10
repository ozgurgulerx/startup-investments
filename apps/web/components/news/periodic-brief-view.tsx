'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { PeriodicBrief, PeriodicBriefSummary } from '@startup-intelligence/shared';
import { PageContainer } from '@/components/layout/page-container';
import { NewsSubscriptionCard } from './news-subscription-card';
import { SignalsProvider } from './signals-provider';
import { ReactionBar } from './reaction-bar';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/50 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-light tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export function PeriodicBriefView({
  brief,
  region,
  archive,
}: {
  brief: PeriodicBrief;
  region: 'global' | 'turkey';
  archive?: PeriodicBriefSummary[];
}) {
  const stats = brief.stats;
  const narrative = brief.narrative;
  const periodLabel = brief.period_type === 'weekly' ? 'Weekly' : 'Monthly';
  const dateRange = formatDateRange(brief.period_start, brief.period_end);
  const regionLabel = region === 'turkey' ? 'Turkey' : 'Global';

  const topStories = stats.top_stories || [];
  const topTopics = stats.top_topics || [];
  const storyTypes = stats.story_types || {};
  const fundingTotal = stats.funding_total_usd;

  const archiveBasePath = region === 'turkey'
    ? `/news/turkey/${brief.period_type}`
    : `/news/${brief.period_type}`;

  const clusterIds = useMemo(
    () => topStories.filter((s) => s.cluster_id).map((s) => s.cluster_id!),
    [topStories]
  );

  return (
    <SignalsProvider clusterIds={clusterIds}>
    <PageContainer className="py-8">
      {/* Header */}
      <header className="mb-8">
        <p className="label-xs text-accent-info">{regionLabel} {periodLabel} Brief</p>
        <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground sm:text-4xl">
          {brief.title || `${regionLabel} ${periodLabel} — ${dateRange}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {dateRange} · {brief.story_count} signals
          {brief.generated_at ? ` · Generated ${new Date(brief.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
        </p>
      </header>

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Signals" value={stats.total_stories || brief.story_count} />
        {fundingTotal != null && fundingTotal > 0 ? (
          <StatCard label="Funding tracked" value={`$${(fundingTotal / 1_000_000).toFixed(0)}M`} />
        ) : null}
        {stats.new_entities_count != null ? (
          <StatCard label="New entities" value={stats.new_entities_count} />
        ) : null}
        {topTopics.length > 0 ? (
          <StatCard label="Top topic" value={topTopics[0].topic} />
        ) : null}
      </div>

      {/* Executive summary */}
      {narrative.executive_summary ? (
        <section className="mb-8 rounded-2xl border border-accent-info/20 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 p-6">
          <p className="label-xs text-accent-info">Executive Summary</p>
          <p className="mt-3 text-base leading-relaxed text-foreground/90">
            {narrative.executive_summary}
          </p>
        </section>
      ) : null}

      {/* Two-column: Trend Analysis + Top Stories */}
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        {/* Trend analysis */}
        {narrative.trend_analysis ? (
          <section className="rounded-xl border border-border/30 bg-card/50 p-5">
            <p className="label-xs text-accent">Trend Analysis</p>
            <p className="mt-3 text-sm leading-relaxed text-foreground/85">
              {narrative.trend_analysis}
            </p>
          </section>
        ) : null}

        {/* Top stories */}
        {topStories.length > 0 ? (
          <section className="rounded-xl border border-border/30 bg-card/50 p-5">
            <p className="label-xs text-accent">Highlights</p>
            <ul className="mt-3 space-y-2">
              {topStories.slice(0, 8).map((story, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-sm text-foreground/85">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent/60" />
                  <div className="flex-1">
                    <span>
                      {story.title}
                      <span className="ml-1.5 inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        {story.story_type}
                      </span>
                    </span>
                    {story.cluster_id && (
                      <div className="mt-1">
                        <ReactionBar clusterId={story.cluster_id} compact />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* Builder lessons */}
      {narrative.builder_lessons ? (
        <section className="mb-8 rounded-xl border border-border/30 bg-card/50 p-5">
          <p className="label-xs text-accent">Builder Lessons</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85 whitespace-pre-line">
            {narrative.builder_lessons}
          </p>
        </section>
      ) : null}

      {/* Outlook */}
      {narrative.outlook ? (
        <section className="mb-8 rounded-xl border border-border/30 bg-card/50 p-5">
          <p className="label-xs text-accent-info">Outlook</p>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">
            {narrative.outlook}
          </p>
        </section>
      ) : null}

      {/* Topics + Story type breakdown */}
      {(topTopics.length > 0 || Object.keys(storyTypes).length > 0) ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          {topTopics.length > 0 ? (
            <section className="rounded-xl border border-border/30 bg-card/50 p-5">
              <p className="label-xs text-muted-foreground">Topics</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {topTopics.map((t) => (
                  <span
                    key={t.topic}
                    className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {t.topic} ({t.count})
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {Object.keys(storyTypes).length > 0 ? (
            <section className="rounded-xl border border-border/30 bg-card/50 p-5">
              <p className="label-xs text-muted-foreground">Story Types</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(storyTypes).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                  <span
                    key={type}
                    className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {type} ({cnt})
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Entity names */}
      {brief.top_entity_names.length > 0 ? (
        <section className="mb-8 rounded-xl border border-border/30 bg-card/50 p-5">
          <p className="label-xs text-muted-foreground">Key Entities</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {brief.top_entity_names.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-xs text-foreground/80"
              >
                {name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Subscribe CTA */}
      <div className="mb-8">
        <NewsSubscriptionCard region={region} />
      </div>

      {/* Archive links */}
      {archive && archive.length > 1 ? (
        <section className="rounded-xl border border-border/30 bg-card/50 p-5">
          <p className="label-xs text-muted-foreground">Past {periodLabel} Briefs</p>
          <ul className="mt-3 space-y-1.5">
            {archive.filter((a) => a.period_start !== brief.period_start).slice(0, 12).map((a) => (
              <li key={a.id}>
                <Link
                  href={`${archiveBasePath}/${a.period_start}`}
                  className="text-sm text-foreground/80 hover:text-accent transition-colors"
                >
                  {formatDateRange(a.period_start, a.period_end)}
                  <span className="ml-2 text-muted-foreground">({a.story_count} signals)</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageContainer>
    </SignalsProvider>
  );
}

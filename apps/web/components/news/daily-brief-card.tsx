import type { DailyNewsBrief } from '@startup-intelligence/shared';

export function DailyBriefCard({ brief }: { brief: DailyNewsBrief }) {
  const bullets = (brief.bullets || []).slice(0, 6).filter(Boolean);
  const themes = (brief.themes || []).slice(0, 6).filter(Boolean);

  const updatedTime = brief.generated_at
    ? new Date(brief.generated_at).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  return (
    <section className="my-4 overflow-hidden rounded-2xl border border-accent-info/20 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 p-6">
      {/* Header row: label + meta */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="label-xs text-accent-info">Today&apos;s Briefing</p>
        {(updatedTime || brief.cluster_count) ? (
          <p className="text-[10px] text-muted-foreground/60">
            {brief.cluster_count ? `Synthesized from ${brief.cluster_count} stories` : null}
            {brief.cluster_count && updatedTime ? ' · ' : null}
            {updatedTime ? `Updated ${updatedTime}` : null}
          </p>
        ) : null}
      </div>

      {/* Headline — editorial, thematic */}
      <h2 className="mt-3 text-xl font-light leading-snug tracking-tight text-foreground sm:text-2xl">
        {brief.headline}
      </h2>

      {/* Summary — the editorial paragraph */}
      {brief.summary ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {brief.summary}
        </p>
      ) : null}

      {/* Bullet points — each a different story, single column for readability */}
      {bullets.length ? (
        <ul className="mt-4 space-y-2">
          {bullets.map((bullet, idx) => (
            <li
              key={`${idx}-${bullet.slice(0, 24)}`}
              className="flex items-start gap-2.5 text-sm text-foreground/85"
            >
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-info/60" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Theme tags */}
      {themes.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {themes.map((theme) => (
            <span
              key={theme}
              className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {theme}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

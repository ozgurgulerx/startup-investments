import type { DailyNewsBrief } from '@startup-intelligence/shared';

export function DailyBriefCard({ brief }: { brief: DailyNewsBrief }) {
  const bullets = (brief.bullets || []).slice(0, 5).filter(Boolean);
  const themes = (brief.themes || []).slice(0, 6).filter(Boolean);

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/75 to-card/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="label-xs text-accent-info">Daily Brief</p>
          <h2 className="mt-2 text-2xl font-light tracking-tight text-foreground">{brief.headline}</h2>
        </div>
      </div>

      {brief.summary ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{brief.summary}</p>
      ) : null}

      {bullets.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {bullets.map((bullet, idx) => (
            <div
              key={`${idx}-${bullet.slice(0, 24)}`}
              className="rounded-lg border border-border/40 bg-background/70 px-3 py-2 text-sm text-foreground/90"
            >
              <span className="mr-2 text-accent-info">•</span>
              {bullet}
            </div>
          ))}
        </div>
      ) : null}

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

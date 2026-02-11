interface BriefDeltaSectionProps {
  bullets: string[];
  revisionBullets?: string[];
}

export function BriefDeltaSection({ bullets, revisionBullets }: BriefDeltaSectionProps) {
  const hasContent = (bullets && bullets.length > 0) || (revisionBullets && revisionBullets.length > 0);
  if (!hasContent) return null;

  return (
    <section className="p-5 border border-accent-info/20 rounded-lg bg-accent-info/5">
      {bullets && bullets.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-wider text-accent-info mb-3 font-medium">
            What Changed vs Previous Period
          </p>
          <ul className="space-y-2">
            {bullets.map((bullet, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                <span className="text-accent-info shrink-0">→</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {revisionBullets && revisionBullets.length > 0 && (
        <div className={bullets && bullets.length > 0 ? 'mt-4 pt-4 border-t border-accent-info/10' : ''}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 font-medium">
            Since Last Update
          </p>
          <ul className="space-y-2">
            {revisionBullets.map((bullet, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                <span className="text-muted-foreground/50 shrink-0">Δ</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

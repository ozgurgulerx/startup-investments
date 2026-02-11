interface BriefDeltaSectionProps {
  bullets: string[];
}

export function BriefDeltaSection({ bullets }: BriefDeltaSectionProps) {
  if (!bullets || bullets.length === 0) return null;

  return (
    <section className="p-5 border border-accent-info/20 rounded-lg bg-accent-info/5">
      <p className="text-[10px] uppercase tracking-wider text-accent-info mb-3 font-medium">
        What Changed Since Last Update
      </p>
      <ul className="space-y-2">
        {bullets.map((bullet, i) => (
          <li key={i} className="flex gap-3 text-sm text-muted-foreground">
            <span className="text-accent-info shrink-0">→</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

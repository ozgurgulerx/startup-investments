import Link from 'next/link';

interface BriefHeaderStripProps {
  generatedAt: string;
  periodLabel: string;
  revisionNumber: number;
  revisionDelta?: string | null;
  kind?: 'rolling' | 'sealed';
}

export function BriefHeaderStrip({ generatedAt, periodLabel, revisionNumber, revisionDelta, kind }: BriefHeaderStripProps) {
  const formattedDate = new Date(generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Last updated: {formattedDate}</span>
      <span className="hidden sm:inline">·</span>
      <span>{periodLabel}</span>
      <span className="hidden sm:inline">·</span>
      <span>Rev {revisionNumber}</span>
      {kind && (
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded ${
          kind === 'sealed' ? 'bg-muted/50 text-muted-foreground' : 'bg-accent-info/10 text-accent-info'
        }`}>
          {kind === 'sealed' ? 'Sealed' : 'Live'}
        </span>
      )}
      {revisionDelta && <span className="text-success text-[10px]">{revisionDelta}</span>}
      <span className="hidden sm:inline">·</span>
      <Link
        href="/methodology"
        className="hover:text-foreground transition-colors"
      >
        Methodology →
      </Link>
    </div>
  );
}

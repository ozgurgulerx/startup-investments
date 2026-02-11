import Link from 'next/link';

interface BriefHeaderStripProps {
  generatedAt: string;
  periodLabel: string;
  revisionNumber: number;
}

export function BriefHeaderStrip({ generatedAt, periodLabel, revisionNumber }: BriefHeaderStripProps) {
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

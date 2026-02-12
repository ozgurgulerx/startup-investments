'use client';

import { useState, useEffect } from 'react';
import type { DeepDiveContent, MoveItem } from '@/lib/api/client';
import { CaseStudyCard } from './case-study-card';

interface CaseStudiesTabProps {
  content: DeepDiveContent;
  signalId: string;
}

export function CaseStudiesTab({ content, signalId }: CaseStudiesTabProps) {
  const [moves, setMoves] = useState<MoveItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/signals/${signalId}/moves`)
      .then(r => r.json())
      .then((data: MoveItem[]) => {
        if (!cancelled) {
          setMoves(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [signalId]);

  const caseStudies = content.case_studies || [];

  if (caseStudies.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">No case studies generated yet.</p>
      </div>
    );
  }

  // Group moves by startup slug
  const movesBySlug: Record<string, MoveItem[]> = {};
  for (const move of moves) {
    movesBySlug[move.startup_slug] = movesBySlug[move.startup_slug] || [];
    movesBySlug[move.startup_slug].push(move);
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground/60">
        {caseStudies.length} case {caseStudies.length === 1 ? 'study' : 'studies'} from the sample pool
      </p>

      <div className="space-y-4">
        {caseStudies.map((study, i) => (
          <CaseStudyCard
            key={study.startup_slug}
            rank={i + 1}
            study={study}
            moves={movesBySlug[study.startup_slug] || []}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}

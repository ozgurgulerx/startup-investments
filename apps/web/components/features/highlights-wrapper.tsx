'use client';

import { Highlights } from './highlights';
import type { HighlightData } from './generate-highlights';

interface HighlightsWrapperProps {
  title?: string;
  highlights: HighlightData[];
  className?: string;
}

export function HighlightsWrapper(props: HighlightsWrapperProps) {
  return <Highlights {...props} />;
}

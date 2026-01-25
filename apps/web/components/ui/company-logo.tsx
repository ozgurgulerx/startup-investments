'use client';

import { useState } from 'react';

// API URL is inlined at build time by Next.js
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface CompanyLogoProps {
  slug: string;
  companyName: string;
  apiUrl?: string;
  className?: string;
}

export function CompanyLogo({
  slug,
  companyName,
  apiUrl = API_URL,
  className = 'w-16 h-16 rounded-lg object-contain bg-muted/30 flex-shrink-0'
}: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return null;
  }

  return (
    <img
      src={`${apiUrl}/api/startups/${slug}/logo`}
      alt={`${companyName} logo`}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}
// Logo API URL: Front Door
// Rebuild 1769341026

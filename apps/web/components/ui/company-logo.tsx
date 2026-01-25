'use client';

import { useState } from 'react';

interface CompanyLogoProps {
  slug: string;
  companyName: string;
  apiUrl?: string;
  className?: string;
}

export function CompanyLogo({
  slug,
  companyName,
  apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
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

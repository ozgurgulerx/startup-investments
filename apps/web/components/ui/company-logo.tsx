'use client';

import { useState } from 'react';

// API URL - hardcoded for Front Door
const API_URL = 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net';

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
// Rebuild 1737842400

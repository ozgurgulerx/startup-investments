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

// Generate initials from company name (max 2 characters)
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function CompanyLogo({
  slug,
  companyName,
  apiUrl = API_URL,
  className = 'w-16 h-16 rounded-lg object-contain bg-muted/30 flex-shrink-0'
}: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);

  // Fallback: show initials when logo fails to load
  if (hasError) {
    return (
      <div
        className={className.replace('object-contain', 'flex items-center justify-center')}
        aria-label={`${companyName} logo placeholder`}
      >
        <span className="text-muted-foreground/60 font-medium text-sm">
          {getInitials(companyName)}
        </span>
      </div>
    );
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

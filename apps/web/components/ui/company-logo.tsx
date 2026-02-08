'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import Image, { type ImageLoader } from 'next/image';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net';
const passthroughLoader: ImageLoader = ({ src }) => src;

interface CompanyLogoProps {
  slug: string;
  companyName: string;
  region?: string;
  apiUrl?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'muted' | 'elevated';
}

const sizeClasses = {
  sm: 'h-10 w-10 text-xs',
  md: 'h-16 w-16 text-sm',
  lg: 'h-20 w-20 text-base',
} as const;

const pixelSizes = {
  sm: 40,
  md: 64,
  lg: 80,
} as const;

const variantClasses = {
  default: 'border-border/45 bg-card/65',
  muted: 'border-border/35 bg-muted/35',
  elevated: 'border-accent/30 bg-card shadow-[0_12px_26px_-18px_rgba(245,158,11,0.7)]',
} as const;

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function CompanyLogo({
  slug,
  companyName,
  region,
  apiUrl = DEFAULT_API_URL,
  className,
  size = 'md',
  variant = 'default',
}: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const initials = getInitials(companyName);
  const shouldShowFallback = hasError || !slug;
  const imageSize = pixelSizes[size];
  const regionQuery = region && region !== 'global' ? `?region=${encodeURIComponent(region)}` : '';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      aria-label={`${companyName} logo`}
      role="img"
    >
      {!shouldShowFallback && (
        <Image
          loader={passthroughLoader}
          unoptimized
          src={`${apiUrl}/api/startups/${slug}/logo${regionQuery}`}
          alt={`${companyName} logo`}
          className={cn(
            'h-full w-full object-contain p-1.5 transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0'
          )}
          width={imageSize}
          height={imageSize}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            setIsLoaded(false);
          }}
        />
      )}

      {!isLoaded && !shouldShowFallback && (
        <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted/10 via-muted/45 to-muted/20" />
      )}

      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-semibold tracking-wide text-muted-foreground/70 transition-opacity duration-200',
          shouldShowFallback ? 'opacity-100' : 'opacity-0'
        )}
      >
        {initials}
      </span>
    </span>
  );
}

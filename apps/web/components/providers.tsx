'use client';

import { SessionProvider } from 'next-auth/react';
import { WatchlistProvider } from '@/lib/watchlist';
import { AudienceProvider } from '@/lib/audience-context';
import { PostHogProvider } from '@/lib/posthog';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PostHogProvider>
        <AudienceProvider>
          <WatchlistProvider>
            {children}
          </WatchlistProvider>
        </AudienceProvider>
      </PostHogProvider>
    </SessionProvider>
  );
}

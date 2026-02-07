'use client';

import { SessionProvider } from 'next-auth/react';
import { WatchlistProvider } from '@/lib/watchlist';
import { AudienceProvider } from '@/lib/audience-context';
import { RegionProvider } from '@/lib/region-context';
import { ReadingModeProvider } from '@/lib/reading-mode-context';
import { PostHogProvider } from '@/lib/posthog';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PostHogProvider>
        <AudienceProvider>
          <RegionProvider>
            <ReadingModeProvider>
              <WatchlistProvider>
                {children}
              </WatchlistProvider>
            </ReadingModeProvider>
          </RegionProvider>
        </AudienceProvider>
      </PostHogProvider>
    </SessionProvider>
  );
}

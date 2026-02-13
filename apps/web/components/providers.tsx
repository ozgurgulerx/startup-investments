'use client';

import { SessionProvider } from 'next-auth/react';
import { WatchlistProvider } from '@/lib/watchlist';
import { AudienceProvider } from '@/lib/audience-context';
import { RegionProvider } from '@/lib/region-context';
import { ReadingModeProvider } from '@/lib/reading-mode-context';
import { PostHogProvider } from '@/lib/posthog';
import { ClarityProvider } from '@/lib/clarity';
import { RegionUrlSync } from '@/components/ui/region-url-sync';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PostHogProvider>
        <ClarityProvider />
        <AudienceProvider>
          <RegionProvider>
            <RegionUrlSync />
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

'use client';

import { SessionProvider } from 'next-auth/react';
import { WatchlistProvider } from '@/lib/watchlist';
import { AudienceProvider } from '@/lib/audience-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AudienceProvider>
        <WatchlistProvider>
          {children}
        </WatchlistProvider>
      </AudienceProvider>
    </SessionProvider>
  );
}

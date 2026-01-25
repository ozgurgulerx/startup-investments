'use client';

import { SessionProvider } from 'next-auth/react';
import { WatchlistProvider } from '@/lib/watchlist';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <WatchlistProvider>
        {children}
      </WatchlistProvider>
    </SessionProvider>
  );
}

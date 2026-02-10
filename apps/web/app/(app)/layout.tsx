'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { useIsDesktop } from '@/lib/hooks/use-media-query';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isDesktop = useIsDesktop();

  return (
    <div className="min-h-svh bg-background overflow-x-hidden">
      {isDesktop && <Sidebar />}
      <div className={isDesktop ? 'pl-56 min-w-0 w-full' : 'w-full min-w-0'}>
        <AppHeader />
        <main className="p-4 lg:p-6">
          <div className="mx-auto w-full max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

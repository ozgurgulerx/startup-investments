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
      <div className={isDesktop ? 'pl-56' : 'w-full'}>
        <AppHeader />
        <main className="p-4 lg:p-6 max-w-5xl">
          {children}
        </main>
      </div>
    </div>
  );
}

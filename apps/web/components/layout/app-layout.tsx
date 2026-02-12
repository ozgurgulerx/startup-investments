'use client';

import { AppSidebar } from './app-sidebar';
import { AppHeader } from './app-header';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-svh bg-background overflow-x-hidden">
      <AppSidebar />
      <div className="lg:pl-56 min-w-0 w-full">
        <AppHeader />
        <main>
          <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

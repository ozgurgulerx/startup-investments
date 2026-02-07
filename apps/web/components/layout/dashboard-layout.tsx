'use client';

import Link from 'next/link';
import { Sidebar } from './sidebar';
import { MobileNavTrigger } from './mobile-nav';
import { BrandMark } from '@/components/ui/brand-mark';

interface DashboardLayoutProps {
  children: React.ReactNode;
  initialPeriod?: string;
  availablePeriods?: string[];
}

export function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-svh bg-background overflow-x-hidden">
      <Sidebar />
      {/* Mobile header - only visible on small screens */}
      <header className="lg:hidden sticky top-0 z-30 h-14 border-b border-border/30 bg-background/95 backdrop-blur-sm">
        <div className="h-full flex items-center px-4 gap-3">
          <MobileNavTrigger />
          <Link href="/" className="inline-flex">
            <BrandMark size="sm" variant="accent" />
          </Link>
        </div>
      </header>
      <main className="lg:pl-56 min-w-0 w-full">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 py-8 lg:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}

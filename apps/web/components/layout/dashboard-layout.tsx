'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

interface DashboardLayoutProps {
  children: React.ReactNode;
  initialPeriod?: string;
  availablePeriods?: string[];
}

export function DashboardLayout({
  children,
  initialPeriod = '2026-01',
  availablePeriods = ['2026-01'],
}: DashboardLayoutProps) {
  const [currentPeriod, setCurrentPeriod] = useState(initialPeriod);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-64">
        <Header
          currentPeriod={currentPeriod}
          availablePeriods={availablePeriods}
          onPeriodChange={setCurrentPeriod}
        />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

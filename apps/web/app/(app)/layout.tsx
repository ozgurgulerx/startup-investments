'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { EntitlementProvider } from '@/lib/entitlement';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EntitlementProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <main className="pl-56">
          <div className="max-w-4xl mx-auto px-8 py-12">
            {children}
          </div>
        </main>
      </div>
    </EntitlementProvider>
  );
}

import { Sidebar } from '@/components/layout/sidebar';
import { AppHeader } from '@/components/layout/app-header';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-56">
        <AppHeader />
        <main className="p-6 max-w-5xl">
          {children}
        </main>
      </div>
    </div>
  );
}

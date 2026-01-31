import { Suspense } from 'react';
import { getStartups, getMonthlyStats } from '@/lib/data';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { InteractiveDealbook } from './interactive-dealbook';
import type { SavedFilter } from '@/components/features';

const DEFAULT_PERIOD = '2026-01';

interface UserPreferencesRow {
  saved_filters: SavedFilter[] | null;
}

async function DealbookContent() {
  const [startups, stats, session] = await Promise.all([
    getStartups(DEFAULT_PERIOD),
    getMonthlyStats(DEFAULT_PERIOD),
    auth(),
  ]);

  // Fetch saved filters if user is logged in
  let savedFilters: SavedFilter[] = [];
  if (session?.user?.id) {
    try {
      const result = await query<UserPreferencesRow>(
        `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
        [session.user.id]
      );
      savedFilters = result.rows[0]?.saved_filters || [];
    } catch (error) {
      console.error('Error fetching saved filters:', error);
    }
  }

  return (
    <InteractiveDealbook
      startups={startups}
      stats={stats}
      initialFilters={savedFilters}
    />
  );
}

function DealbookLoading() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="space-y-4">
        <div className="h-3 w-32 bg-muted rounded" />
        <div className="h-8 w-2/3 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
      <div className="h-24 bg-muted rounded-lg" />
      <div className="h-px bg-border" />
      <div className="space-y-0">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="py-6 border-b border-border/30">
            <div className="h-5 w-1/3 bg-muted rounded mb-2" />
            <div className="h-4 w-2/3 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DealbookPage() {
  return (
    <Suspense fallback={<DealbookLoading />}>
      <DealbookContent />
    </Suspense>
  );
}

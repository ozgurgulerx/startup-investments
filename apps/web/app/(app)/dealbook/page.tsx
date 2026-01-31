import { Suspense } from 'react';
import { getStartupsPaginated, getFilterOptions, getMonthlyStats } from '@/lib/data';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { InteractiveDealbook } from './interactive-dealbook';
import { Pagination, PaginationInfo } from '@/components/ui';
import type { SavedFilter } from '@/components/features';

const DEFAULT_PERIOD = '2026-01';
const DEFAULT_LIMIT = 25;

interface UserPreferencesRow {
  saved_filters: SavedFilter[] | null;
}

interface PageProps {
  searchParams: Promise<{
    page?: string;
    stage?: string;
    pattern?: string;
    continent?: string;
    minFunding?: string;
    maxFunding?: string;
    usesGenai?: string;
    search?: string;
  }>;
}

async function DealbookContent({ searchParams }: { searchParams: PageProps['searchParams'] }) {
  const params = await searchParams;

  // Parse URL parameters
  const page = parseInt(params.page || '1', 10);
  const filters = {
    stage: params.stage,
    pattern: params.pattern,
    continent: params.continent,
    minFunding: params.minFunding ? parseInt(params.minFunding, 10) : undefined,
    maxFunding: params.maxFunding ? parseInt(params.maxFunding, 10) : undefined,
    usesGenai: params.usesGenai === 'true' ? true : params.usesGenai === 'false' ? false : undefined,
    search: params.search,
  };

  const [paginatedResult, filterOptions, stats, session] = await Promise.all([
    getStartupsPaginated(DEFAULT_PERIOD, {
      page,
      limit: DEFAULT_LIMIT,
      ...filters,
    }),
    getFilterOptions(DEFAULT_PERIOD),
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

  // Build current search params for pagination links
  const currentSearchParams: Record<string, string | undefined> = {};
  if (filters.stage) currentSearchParams.stage = filters.stage;
  if (filters.pattern) currentSearchParams.pattern = filters.pattern;
  if (filters.continent) currentSearchParams.continent = filters.continent;
  if (filters.minFunding) currentSearchParams.minFunding = filters.minFunding.toString();
  if (filters.maxFunding) currentSearchParams.maxFunding = filters.maxFunding.toString();
  if (filters.usesGenai !== undefined) currentSearchParams.usesGenai = filters.usesGenai.toString();
  if (filters.search) currentSearchParams.search = filters.search;

  const hasFilters = Object.values(filters).some(v => v !== undefined);

  return (
    <>
      <InteractiveDealbook
        startups={paginatedResult.data}
        stats={stats}
        initialFilters={savedFilters}
        filterOptions={filterOptions}
        urlFilters={filters}
        pagination={paginatedResult.pagination}
        hasUrlFilters={hasFilters}
      />

      {/* Pagination controls */}
      {paginatedResult.pagination.totalPages > 1 && (
        <div className="mt-8 flex flex-col items-center gap-4 border-t border-border/30 pt-6">
          <PaginationInfo
            currentPage={paginatedResult.pagination.page}
            limit={paginatedResult.pagination.limit}
            total={paginatedResult.pagination.total}
          />
          <Pagination
            currentPage={paginatedResult.pagination.page}
            totalPages={paginatedResult.pagination.totalPages}
            baseUrl="/dealbook"
            searchParams={currentSearchParams}
          />
        </div>
      )}
    </>
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

export default async function DealbookPage(props: PageProps) {
  return (
    <Suspense fallback={<DealbookLoading />}>
      <DealbookContent searchParams={props.searchParams} />
    </Suspense>
  );
}

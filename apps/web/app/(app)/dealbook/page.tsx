import { Suspense } from 'react';
import { getStartupsPaginated, getFilterOptions, getMonthlyStats, getAvailablePeriods, DEFAULT_STATS } from '@/lib/data';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { InteractiveDealbook } from './interactive-dealbook';
import { Pagination, PaginationInfo } from '@/components/ui';
import type { SavedFilter } from '@/components/features';
import { redirect } from 'next/navigation';
import { normalizeDatasetRegion } from '@/lib/region';

export const dynamic = 'force-dynamic';

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const DEFAULT_LIMIT = 25;

interface UserPreferencesRow {
  saved_filters: SavedFilter[] | null;
}

interface PageProps {
  searchParams: Promise<{
    page?: string;
    month?: string;
    region?: string;
    sort?: string;
    stage?: string;
    pattern?: string;
    continent?: string;
    vertical?: string;
    verticalId?: string;
    subVerticalId?: string;
    leafId?: string;
    minFunding?: string;
    maxFunding?: string;
    usesGenai?: string;
    search?: string;
  }>;
}

async function DealbookContent({ searchParams }: { searchParams: PageProps['searchParams'] }) {
  const params = await searchParams;
  const region = normalizeDatasetRegion(params.region);

  // Get available periods and determine selected month
  const availablePeriods = await getAvailablePeriods(region);
  const latestPeriod = availablePeriods[0]?.period || getCurrentPeriod();

  // If the user applies filters without explicitly choosing a month,
  // default the scope to all-time (otherwise the latest month can look "broken" with tiny counts).
  const hasAnyFilterWithoutMonth =
    !params.month &&
    !!(
      params.stage ||
      params.pattern ||
      params.continent ||
      params.vertical ||
      params.verticalId ||
      params.subVerticalId ||
      params.leafId ||
      params.minFunding ||
      params.maxFunding ||
      params.usesGenai ||
      params.search
    );
  if (hasAnyFilterWithoutMonth) {
    const nextParams = new URLSearchParams();
    nextParams.set('month', 'all');
    if (region !== 'global') nextParams.set('region', region);
    if (params.page) nextParams.set('page', params.page);
    if (params.sort) nextParams.set('sort', params.sort);
    if (params.stage) nextParams.set('stage', params.stage);
    if (params.pattern) nextParams.set('pattern', params.pattern);
    if (params.continent) nextParams.set('continent', params.continent);
    if (params.vertical) nextParams.set('vertical', params.vertical);
    if (params.verticalId) nextParams.set('verticalId', params.verticalId);
    if (params.subVerticalId) nextParams.set('subVerticalId', params.subVerticalId);
    if (params.leafId) nextParams.set('leafId', params.leafId);
    if (params.minFunding) nextParams.set('minFunding', params.minFunding);
    if (params.maxFunding) nextParams.set('maxFunding', params.maxFunding);
    if (params.usesGenai) nextParams.set('usesGenai', params.usesGenai);
    if (params.search) nextParams.set('search', params.search);
    redirect(`/dealbook/?${nextParams.toString()}`);
  }

  // Support 'all' for all-time view, or specific month, or default to latest
  const selectedMonth = params.month === 'all' ? 'all' : (params.month || latestPeriod);
  // Avoid all-time stats aggregation on the web tier (it depends on local monthly_stats.json files).
  // For all-time scope, we render totals from the filtered result set instead.
  const statsPeriod = selectedMonth === 'all' ? latestPeriod : selectedMonth;

  // Parse URL parameters
  const page = parseInt(params.page || '1', 10);

  // Parse sort parameter
  const sortParam = params.sort || 'funding_desc';
  const sortConfig = {
    sortBy: sortParam.startsWith('funding') ? 'funding' as const
          : sortParam.startsWith('name') ? 'name' as const
          : sortParam.startsWith('recency') ? 'date' as const
          : 'funding' as const,
    sortOrder: sortParam.endsWith('_asc') ? 'asc' as const : 'desc' as const,
  };

  const filters = {
    stage: params.stage,
    pattern: params.pattern,
    continent: params.continent,
    vertical: params.vertical,
    verticalId: params.verticalId,
    subVerticalId: params.subVerticalId,
    leafId: params.leafId,
    minFunding: params.minFunding ? (Number.isFinite(parseInt(params.minFunding, 10)) ? parseInt(params.minFunding, 10) : undefined) : undefined,
    maxFunding: params.maxFunding ? (Number.isFinite(parseInt(params.maxFunding, 10)) ? parseInt(params.maxFunding, 10) : undefined) : undefined,
    usesGenai: params.usesGenai === 'true' ? true : params.usesGenai === 'false' ? false : undefined,
    search: params.search,
    ...sortConfig,
  };

  const [paginatedResult, filterOptions, stats, session] = await Promise.all([
    getStartupsPaginated(selectedMonth, {
      page,
      limit: DEFAULT_LIMIT,
      region,
      ...filters,
    }),
    getFilterOptions(selectedMonth, region, { verticalId: params.verticalId, subVerticalId: params.subVerticalId }),
    getMonthlyStats(statsPeriod, region).catch(() => ({ ...DEFAULT_STATS, period: statsPeriod })),
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
  // Always include month in pagination links (unless it's the default/latest)
  if (params.month && params.month !== latestPeriod) {
    currentSearchParams.month = params.month;
  }
  if (region !== 'global') currentSearchParams.region = region;
  if (params.sort && params.sort !== 'funding_desc') {
    currentSearchParams.sort = params.sort;
  }
  if (filters.stage) currentSearchParams.stage = filters.stage;
  if (filters.pattern) currentSearchParams.pattern = filters.pattern;
  if (filters.continent) currentSearchParams.continent = filters.continent;
  if (filters.vertical) currentSearchParams.vertical = filters.vertical;
  if (filters.verticalId) currentSearchParams.verticalId = filters.verticalId;
  if (filters.subVerticalId) currentSearchParams.subVerticalId = filters.subVerticalId;
  if (filters.leafId) currentSearchParams.leafId = filters.leafId;
  if (filters.minFunding !== undefined) currentSearchParams.minFunding = filters.minFunding.toString();
  if (filters.maxFunding !== undefined) currentSearchParams.maxFunding = filters.maxFunding.toString();
  if (filters.usesGenai !== undefined) currentSearchParams.usesGenai = filters.usesGenai.toString();
  if (filters.search) currentSearchParams.search = filters.search;

  const hasFilters = !!(
    filters.stage ||
    filters.pattern ||
    filters.continent ||
    filters.vertical ||
    filters.verticalId ||
    filters.subVerticalId ||
    filters.leafId ||
    filters.minFunding !== undefined ||
    filters.maxFunding !== undefined ||
    filters.usesGenai !== undefined ||
    (filters.search && filters.search.trim().length > 0)
  );

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
        selectedMonth={selectedMonth}
        availablePeriods={availablePeriods}
        region={region}
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
            baseUrl="/dealbook/"
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

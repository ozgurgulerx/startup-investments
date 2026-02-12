import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { randomUUID } from 'crypto';
import { canCreateSavedFilter, getPlanLimits, type UserPlan } from '@/lib/feature-flags';

/**
 * SavedFilter interface matching the schema in user_preferences.saved_filters
 */
interface SavedFilter {
  id: string;
  name: string;
  query: {
    stages?: string[];
    patterns?: string[];
    continents?: string[];
    fundingMin?: number;
    fundingMax?: number;
    usesGenai?: boolean;
    verticals?: string[];
  };
  alertsEnabled: boolean;
  createdAt: string;
}

interface UserPreferencesRow {
  saved_filters: SavedFilter[] | null;
}

interface UserRow {
  plan: UserPlan | null;
}

function parseSavedFilterQuery(raw: unknown): {
  data?: SavedFilter['query'];
  errors?: string[];
} {
  if (!raw || typeof raw !== 'object') {
    return { errors: ['query must be an object'] };
  }

  const value = raw as Record<string, unknown>;
  const parsed: SavedFilter['query'] = {};
  const errors: string[] = [];

  const parseStringArray = (field: 'stages' | 'patterns' | 'continents' | 'verticals') => {
    const input = value[field];
    if (input === undefined) return;
    if (!Array.isArray(input) || !input.every((v) => typeof v === 'string' && v.length <= 100)) {
      errors.push(`${field} must be an array of strings (<=100 chars)`);
      return;
    }
    parsed[field] = input;
  };

  parseStringArray('stages');
  parseStringArray('patterns');
  parseStringArray('continents');
  parseStringArray('verticals');

  const parseNumber = (field: 'fundingMin' | 'fundingMax') => {
    const input = value[field];
    if (input === undefined) return;
    const num = typeof input === 'string' ? Number.parseFloat(input) : Number(input);
    if (!Number.isFinite(num) || num < 0) {
      errors.push(`${field} must be a non-negative number`);
      return;
    }
    parsed[field] = num;
  };

  parseNumber('fundingMin');
  parseNumber('fundingMax');

  if (value.usesGenai !== undefined) {
    if (typeof value.usesGenai !== 'boolean') {
      errors.push('usesGenai must be a boolean');
    } else {
      parsed.usesGenai = value.usesGenai;
    }
  }

  if (errors.length > 0) return { errors };
  return { data: parsed };
}

// GET /api/filters - Get user's saved filters
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await query<UserPreferencesRow>(
      `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
      [session.user.id]
    );

    const filters = result.rows[0]?.saved_filters || [];

    return NextResponse.json({
      filters,
    });
  } catch (error) {
    console.error('Error fetching filters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch filters' },
      { status: 500 }
    );
  }
}

// POST /api/filters - Create a new saved filter
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) {
      return NextResponse.json(
        {
          error: 'Invalid request payload',
          details: ['name is required and must be <=120 characters'],
        },
        { status: 400 }
      );
    }
    const parsedQuery = parseSavedFilterQuery(body?.query);
    if (!parsedQuery.data) {
      return NextResponse.json(
        {
          error: 'Invalid request payload',
          details: parsedQuery.errors,
        },
        { status: 400 }
      );
    }
    const alertsEnabled = body?.alertsEnabled === true || body?.alertsEnabled === 'true';
    const filterQuery = parsedQuery.data;

    // Get user's plan and existing filters
    const [userResult, existingResult] = await Promise.all([
      query<UserRow>(`SELECT plan FROM users WHERE id = $1`, [session.user.id]),
      query<UserPreferencesRow>(
        `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
        [session.user.id]
      ),
    ]);

    const userPlan = userResult.rows[0]?.plan || 'free';
    const existingFilters = existingResult.rows[0]?.saved_filters || [];

    // Check if user can create more filters
    if (!canCreateSavedFilter(userPlan, existingFilters.length)) {
      const limits = getPlanLimits(userPlan);
      return NextResponse.json(
        {
          error: 'Filter limit reached',
          message: `Your ${userPlan} plan allows up to ${limits.savedFilters} saved filters. Upgrade to save more.`,
          code: 'LIMIT_REACHED',
        },
        { status: 403 }
      );
    }

    // Create the new filter
    const newFilter: SavedFilter = {
      id: randomUUID(),
      name,
      query: filterQuery,
      alertsEnabled,
      createdAt: new Date().toISOString(),
    };

    const updatedFilters = [...existingFilters, newFilter];

    // Upsert user preferences with the new filter
    await query(
      `INSERT INTO user_preferences (user_id, saved_filters)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET
         saved_filters = $2::jsonb,
         updated_at = NOW()`,
      [session.user.id, JSON.stringify(updatedFilters)]
    );

    return NextResponse.json({
      success: true,
      filter: newFilter,
    });
  } catch (error) {
    console.error('Error creating filter:', error);
    return NextResponse.json(
      { error: 'Failed to create filter' },
      { status: 500 }
    );
  }
}

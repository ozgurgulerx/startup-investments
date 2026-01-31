import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { randomUUID } from 'crypto';

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
    const { name, query: filterQuery, alertsEnabled = false } = body;

    if (!name || !filterQuery) {
      return NextResponse.json(
        { error: 'name and query are required' },
        { status: 400 }
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

    // Get existing filters
    const existingResult = await query<UserPreferencesRow>(
      `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
      [session.user.id]
    );

    const existingFilters = existingResult.rows[0]?.saved_filters || [];
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

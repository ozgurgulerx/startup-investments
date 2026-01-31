import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

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

// PUT /api/filters/[id] - Update a saved filter
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { name, query: filterQuery, alertsEnabled } = body;

    // Get existing filters
    const existingResult = await query<UserPreferencesRow>(
      `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
      [session.user.id]
    );

    const existingFilters = existingResult.rows[0]?.saved_filters || [];
    const filterIndex = existingFilters.findIndex(f => f.id === id);

    if (filterIndex === -1) {
      return NextResponse.json(
        { error: 'Filter not found' },
        { status: 404 }
      );
    }

    // Update the filter
    const updatedFilter: SavedFilter = {
      ...existingFilters[filterIndex],
      ...(name !== undefined && { name }),
      ...(filterQuery !== undefined && { query: filterQuery }),
      ...(alertsEnabled !== undefined && { alertsEnabled }),
    };

    const updatedFilters = [...existingFilters];
    updatedFilters[filterIndex] = updatedFilter;

    // Save back to database
    await query(
      `UPDATE user_preferences SET
         saved_filters = $1::jsonb,
         updated_at = NOW()
       WHERE user_id = $2`,
      [JSON.stringify(updatedFilters), session.user.id]
    );

    return NextResponse.json({
      success: true,
      filter: updatedFilter,
    });
  } catch (error) {
    console.error('Error updating filter:', error);
    return NextResponse.json(
      { error: 'Failed to update filter' },
      { status: 500 }
    );
  }
}

// DELETE /api/filters/[id] - Delete a saved filter
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get existing filters
    const existingResult = await query<UserPreferencesRow>(
      `SELECT saved_filters FROM user_preferences WHERE user_id = $1`,
      [session.user.id]
    );

    const existingFilters = existingResult.rows[0]?.saved_filters || [];
    const filteredFilters = existingFilters.filter(f => f.id !== id);

    if (filteredFilters.length === existingFilters.length) {
      return NextResponse.json(
        { error: 'Filter not found' },
        { status: 404 }
      );
    }

    // Save back to database
    await query(
      `UPDATE user_preferences SET
         saved_filters = $1::jsonb,
         updated_at = NOW()
       WHERE user_id = $2`,
      [JSON.stringify(filteredFilters), session.user.id]
    );

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    console.error('Error deleting filter:', error);
    return NextResponse.json(
      { error: 'Failed to delete filter' },
      { status: 500 }
    );
  }
}

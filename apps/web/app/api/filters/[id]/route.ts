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
    verticalId?: string;
    subVerticalId?: string;
    leafId?: string;
  };
  alertsEnabled: boolean;
  createdAt: string;
}

interface UserPreferencesRow {
  saved_filters: SavedFilter[] | null;
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

  const parseTaxonomyId = (field: 'verticalId' | 'subVerticalId' | 'leafId') => {
    const input = value[field];
    if (input === undefined) return;
    if (typeof input !== 'string' || input.length === 0 || input.length > 80) {
      errors.push(`${field} must be a non-empty string (<=80 chars)`);
      return;
    }
    if (!/^[a-z0-9_]+$/.test(input)) {
      errors.push(`${field} must match /^[a-z0-9_]+$/`);
      return;
    }
    parsed[field] = input;
  };

  parseTaxonomyId('verticalId');
  parseTaxonomyId('subVerticalId');
  parseTaxonomyId('leafId');

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
    const errors: string[] = [];

    let name: string | undefined;
    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 120) {
        errors.push('name must be a non-empty string <=120 characters');
      } else {
        name = body.name.trim();
      }
    }

    let filterQuery: SavedFilter['query'] | undefined;
    if (body?.query !== undefined) {
      const parsedQuery = parseSavedFilterQuery(body.query);
      if (!parsedQuery.data) {
        errors.push(...(parsedQuery.errors || []));
      } else {
        filterQuery = parsedQuery.data;
      }
    }

    let alertsEnabled: boolean | undefined;
    if (body?.alertsEnabled !== undefined) {
      if (typeof body.alertsEnabled !== 'boolean') {
        errors.push('alertsEnabled must be a boolean');
      } else {
        alertsEnabled = body.alertsEnabled;
      }
    }

    if (name === undefined && filterQuery === undefined && alertsEnabled === undefined) {
      errors.push('At least one field must be provided');
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: 'Invalid request payload',
          details: errors,
        },
        { status: 400 }
      );
    }

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

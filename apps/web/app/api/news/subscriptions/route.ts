import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function baseUrlFromRequest(req: NextRequest): string {
  const host = req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || 'https';
  if (!host) return 'https://buildatlas.net';
  return `${protocol}://${host}`;
}

// GET /api/news/subscriptions?token=<unsubscribe_token>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing unsubscribe token' }, { status: 400 });
    }

    const result = await query(
      `
      UPDATE news_email_subscriptions
      SET status = 'unsubscribed',
          updated_at = NOW()
      WHERE unsubscribe_token = $1::uuid
      RETURNING id
      `,
      [token]
    );

    const url = new URL('/news', baseUrlFromRequest(req));
    url.searchParams.set('unsubscribed', result.rowCount > 0 ? '1' : '0');
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    console.error('Error unsubscribing from daily news:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}

// POST /api/news/subscriptions
// body: { email: string, builderFocus?: boolean, source?: string }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      builderFocus?: boolean;
      source?: string;
    };
    const emailRaw = body.email || '';
    const email = normalizeEmail(emailRaw);

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const source = (body.source || 'website').slice(0, 80);
    const preferences = {
      builder_focus: body.builderFocus !== false,
      cadence: 'daily',
      digest_type: 'popularity_ranked',
    };

    const result = await query<{ unsubscribe_token: string }>(
      `
      INSERT INTO news_email_subscriptions (
        email,
        email_normalized,
        status,
        source,
        preferences_json,
        updated_at
      )
      VALUES ($1, $2, 'active', $3, $4::jsonb, NOW())
      ON CONFLICT (email_normalized) DO UPDATE
      SET email = EXCLUDED.email,
          status = 'active',
          source = EXCLUDED.source,
          preferences_json = EXCLUDED.preferences_json,
          updated_at = NOW()
      RETURNING unsubscribe_token::text
      `,
      [emailRaw.trim(), email, source, JSON.stringify(preferences)]
    );

    return NextResponse.json({
      ok: true,
      message: 'Subscribed to daily startup news',
      unsubscribe_token: result.rows[0]?.unsubscribe_token,
    });
  } catch (error) {
    console.error('Error creating news subscription:', error);
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
  }
}

// DELETE /api/news/subscriptions
// body: { email: string }
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = normalizeEmail(body.email || '');
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    await query(
      `
      UPDATE news_email_subscriptions
      SET status = 'unsubscribed',
          updated_at = NOW()
      WHERE email_normalized = $1
      `,
      [email]
    );

    return NextResponse.json({ ok: true, message: 'Unsubscribed' });
  } catch (error) {
    console.error('Error removing news subscription:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}

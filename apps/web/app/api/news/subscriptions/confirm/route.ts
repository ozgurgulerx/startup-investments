import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function baseUrlFromRequest(req: NextRequest): string {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured.startsWith('https://') || configured.startsWith('http://')) {
    return configured;
  }
  const host = req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || 'https';
  if (!host) return 'https://buildatlas.net';
  return `${protocol}://${host}`;
}

const CONFIRMATION_TTL_DAYS = 7;

// GET /api/news/subscriptions/confirm?token=<confirmation_token>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing confirmation token' }, { status: 400 });
    }

    // Activate the subscription if it's pending confirmation
    const result = await query<{ region: string; status: string }>(
      `
      UPDATE news_email_subscriptions
      SET status = 'active',
          confirmed_at = NOW(),
          updated_at = NOW()
      WHERE confirmation_token = $1::uuid
        AND status = 'pending_confirmation'
        AND COALESCE(confirmation_sent_at, updated_at) > NOW() - ($2::int * INTERVAL '1 day')
      RETURNING region
      `,
      [token, CONFIRMATION_TTL_DAYS]
    );

    const baseUrl = baseUrlFromRequest(req);

    if (result.rowCount === 0) {
      // Token not found or already confirmed — check if it exists at all
      const existing = await query<{ status: string; region: string }>(
        `
        SELECT status, region
        FROM news_email_subscriptions
        WHERE confirmation_token = $1::uuid
        `,
        [token]
      );

      if (existing.rowCount > 0) {
        const row = existing.rows[0];
        const newsPath = row.region === 'turkey' ? '/news/turkey' : '/news';
        const url = new URL(newsPath, baseUrl);

        if (row.status === 'active') {
          url.searchParams.set('confirmed', 'already');
          return NextResponse.redirect(url, { status: 302 });
        }

        // Pending but expired (or unsubscribed/bounced) — treat as expired
        url.searchParams.set('confirmed', 'expired');
        return NextResponse.redirect(url, { status: 302 });
      }

      // Invalid or expired token
      const url = new URL('/news', baseUrl);
      url.searchParams.set('confirmed', 'expired');
      return NextResponse.redirect(url, { status: 302 });
    }

    // Successfully confirmed
    const region = result.rows[0].region;
    const newsPath = region === 'turkey' ? '/news/turkey' : '/news';
    const url = new URL(newsPath, baseUrl);
    url.searchParams.set('confirmed', '1');
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    console.error('Error confirming subscription:', error);
    return NextResponse.json({ error: 'Failed to confirm subscription' }, { status: 500 });
  }
}

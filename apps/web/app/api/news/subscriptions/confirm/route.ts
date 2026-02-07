import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function baseUrlFromRequest(req: NextRequest): string {
  const host = req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || 'https';
  if (!host) return 'https://buildatlas.net';
  return `${protocol}://${host}`;
}

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
      RETURNING region
      `,
      [token]
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

      if (existing.rowCount > 0 && existing.rows[0].status === 'active') {
        // Already confirmed — redirect with appropriate message
        const region = existing.rows[0].region;
        const newsPath = region === 'turkey' ? '/news/turkey' : '/news';
        const url = new URL(newsPath, baseUrl);
        url.searchParams.set('confirmed', 'already');
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

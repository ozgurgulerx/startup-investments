import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function baseUrlFromRequest(_req: NextRequest): string {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured.startsWith('https://') || configured.startsWith('http://')) {
    return configured;
  }
  return 'https://buildatlas.net';
}

const CONFIRMATION_TTL_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getPostHogEnv(): { host: string; key: string } | null {
  const key = (process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || '').trim();
  if (!key) return null;
  const host = (process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com')
    .trim()
    .replace(/\/+$/, '');
  return { host, key };
}

function hashedDistinctId(seed: string): string {
  return `news-subscription-${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

async function capturePosthogEvent(
  event: string,
  distinctSeed: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const config = getPostHogEnv();
  if (!config) return;
  try {
    await fetch(`${config.host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.key,
        event,
        distinct_id: hashedDistinctId(distinctSeed),
        properties,
      }),
    });
  } catch (error) {
    console.warn('PostHog capture failed (subscription confirm):', error);
  }
}

// GET /api/news/subscriptions/confirm?token=<confirmation_token>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing confirmation token' }, { status: 400 });
    }

    if (!UUID_RE.test(token)) {
      const url = new URL('/news', baseUrlFromRequest(req));
      url.searchParams.set('confirmed', 'expired');
      return NextResponse.redirect(url, { status: 302 });
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
    void capturePosthogEvent('subscription_confirmed', token, {
      region,
      source: 'news-subscription-confirm',
    });
    const newsPath = region === 'turkey' ? '/news/turkey' : '/news';
    const url = new URL(newsPath, baseUrl);
    url.searchParams.set('confirmed', '1');
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    console.error('Error confirming subscription:', error);
    return NextResponse.json({ error: 'Failed to confirm subscription' }, { status: 500 });
  }
}

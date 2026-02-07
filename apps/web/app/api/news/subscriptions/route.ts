import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_REGIONS = ['global', 'turkey'] as const;
type Region = (typeof VALID_REGIONS)[number];
const CONFIRMATION_TTL_DAYS = 7;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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

function regionLabel(region: Region): string {
  return region === 'turkey' ? 'Turkey' : 'Global';
}

function buildConfirmationEmailHtml(confirmUrl: string, region: Region): string {
  const label = regionLabel(region);
  return `<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
          <tr>
            <td>
              <div style="font-size:11px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Build Atlas</div>
              <h1 style="margin:12px 0 8px 0;font-size:24px;line-height:1.3;color:#0f172a;font-weight:600;">Confirm your subscription</h1>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#475569;">
                You requested the <strong>${label} Signal Feed</strong> digest — daily startup signals ranked by impact and cross-source corroboration.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:8px;background:#f59e0b;">
                    <a href="${confirmUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#1c1917;text-decoration:none;border-radius:8px;">
                      Confirm subscription
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">
                If you didn't request this, you can safely ignore this email. This link expires in ${CONFIRMATION_TTL_DAYS} days.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildConfirmationEmailText(confirmUrl: string, region: Region): string {
  const label = regionLabel(region);
  return [
    'Build Atlas — Confirm your subscription',
    '',
    `You requested the ${label} Signal Feed digest.`,
    '',
    'Click the link below to confirm:',
    confirmUrl,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');
}

async function sendConfirmationEmail(
  email: string,
  confirmationToken: string,
  region: Region,
  baseUrl: string,
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set — skipping confirmation email');
    return;
  }

  const confirmUrl = `${baseUrl}/api/news/subscriptions/confirm?token=${confirmationToken}`;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL
    || process.env.NEWS_DIGEST_FROM_EMAIL
    || 'Build Atlas <news@buildatlas.net>';
  const replyTo = (process.env.NEWS_DIGEST_REPLY_TO || '').trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: `Confirm your Build Atlas ${regionLabel(region)} Signal Feed subscription`,
      html: buildConfirmationEmailHtml(confirmUrl, region),
      text: buildConfirmationEmailText(confirmUrl, region),
      reply_to: replyTo || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Resend API error (${response.status}):`, body);
    throw new Error(`Failed to send confirmation email: ${response.status}`);
  }
}

// GET /api/news/subscriptions?token=<unsubscribe_token>
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Missing unsubscribe token' }, { status: 400 });
    }

    const result = await query<{ region: string }>(
      `
      UPDATE news_email_subscriptions
      SET status = 'unsubscribed',
          updated_at = NOW()
      WHERE unsubscribe_token = $1::uuid
      RETURNING region
      `,
      [token]
    );

    const region = result.rows[0]?.region;
    const newsPath = region === 'turkey' ? '/news/turkey' : '/news';
    const url = new URL(newsPath, baseUrlFromRequest(req));
    url.searchParams.set('unsubscribed', result.rowCount > 0 ? '1' : '0');
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    console.error('Error unsubscribing from daily news:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}

// POST /api/news/subscriptions
// body: { email: string, builderFocus?: boolean, source?: string, region?: 'global' | 'turkey' }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      builderFocus?: boolean;
      source?: string;
      region?: string;
    };
    const emailRaw = body.email || '';
    const email = normalizeEmail(emailRaw);

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const region: Region = VALID_REGIONS.includes(body.region as Region)
      ? (body.region as Region)
      : 'global';

    const source = (body.source || 'website').slice(0, 80);
    const preferences = {
      builder_focus: body.builderFocus !== false,
      cadence: 'daily',
      digest_type: 'popularity_ranked',
    };

    // Upsert: insert as pending_confirmation, or re-send confirmation if already pending
    const result = await query<{ confirmation_token: string; status: string }>(
      `
      INSERT INTO news_email_subscriptions (
        email,
        email_normalized,
        status,
        source,
        region,
        preferences_json,
        confirmation_token,
        updated_at
      )
      VALUES ($1, $2, 'pending_confirmation', $3, $4, $5::jsonb, gen_random_uuid(), NOW())
      ON CONFLICT (email_normalized, region) DO UPDATE
      SET email = EXCLUDED.email,
          source = EXCLUDED.source,
          preferences_json = EXCLUDED.preferences_json,
          confirmation_token = CASE
            WHEN news_email_subscriptions.status = 'active'
            THEN news_email_subscriptions.confirmation_token
            ELSE gen_random_uuid()
          END,
          status = CASE
            WHEN news_email_subscriptions.status = 'active'
            THEN 'active'
            ELSE 'pending_confirmation'
          END,
          updated_at = NOW()
      RETURNING confirmation_token::text, status
      `,
      [emailRaw.trim(), email, source, region, JSON.stringify(preferences)]
    );

    const row = result.rows[0];

    // If already active, don't resend confirmation — they're already subscribed
    if (row?.status === 'active') {
      return NextResponse.json({
        ok: true,
        message: 'You are already subscribed',
        already_confirmed: true,
      });
    }

    // Send confirmation email
    const baseUrl = baseUrlFromRequest(req);
    try {
      await sendConfirmationEmail(emailRaw.trim(), row.confirmation_token, region, baseUrl);
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Don't fail the subscription — they can re-subscribe to get a new email.
      return NextResponse.json({
        ok: true,
        message: 'Subscription created, but we could not send the confirmation email. Please try again in a minute.',
      });
    }

    return NextResponse.json({
      ok: true,
      message: 'Check your inbox to confirm your subscription',
    });
  } catch (error) {
    console.error('Error creating news subscription:', error);
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
  }
}

// DELETE /api/news/subscriptions
// body: { email: string, region?: string }
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; region?: string };
    const email = normalizeEmail(body.email || '');
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const region: Region = VALID_REGIONS.includes(body.region as Region)
      ? (body.region as Region)
      : 'global';

    await query(
      `
      UPDATE news_email_subscriptions
      SET status = 'unsubscribed',
          updated_at = NOW()
      WHERE email_normalized = $1 AND region = $2
      `,
      [email, region]
    );

    return NextResponse.json({ ok: true, message: 'Unsubscribed' });
  } catch (error) {
    console.error('Error removing news subscription:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}

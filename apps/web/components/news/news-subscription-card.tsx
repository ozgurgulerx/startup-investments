'use client';

import { FormEvent, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';

interface NewsSubscriptionCardProps {
  className?: string;
  region?: 'global' | 'turkey';
}

export function NewsSubscriptionCard({ className, region = 'global' }: NewsSubscriptionCardProps) {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [builderFocus, setBuilderFocus] = useState(true);
  const [includeOtherRegion, setIncludeOtherRegion] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'already' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [subscribedBoth, setSubscribedBoth] = useState(false);

  const otherRegion = region === 'turkey' ? 'global' : 'turkey';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');

    try {
      // Detect subscriber timezone from browser for local-time delivery (08:45)
      let tz = 'Europe/Istanbul';
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
      } catch { /* fallback to Istanbul */ }

      const payload = {
        email,
        builderFocus,
        region,
        timezone: tz,
        source: 'news-module',
      };

      const res = await fetch('/api/news/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        already_confirmed?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || 'Failed to subscribe');
      }

      // Cross-region subscription (if opted in)
      if (includeOtherRegion) {
        await fetch('/api/news/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, region: otherRegion }),
        });
      }

      setSubscribedBoth(includeOtherRegion);
      setSubmittedEmail(email);
      setStatus(body.already_confirmed ? 'already' : 'done');
      setMessage(body.message || 'Check your inbox to confirm');
      setEmail('');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Subscription failed');
    }
  }

  const regionLabel = region === 'turkey' ? 'Turkey' : 'Global';
  const otherRegionLabel = region === 'turkey' ? 'Global' : 'Turkey';

  // Show confirmation success state
  if (status === 'done') {
    const digestLabel = subscribedBoth
      ? `${regionLabel} + ${otherRegionLabel} Signal Feed digests`
      : `${regionLabel} Signal Feed digest`;

    return (
      <section className={`rounded-2xl border border-success/25 bg-gradient-to-br from-success/10 via-card/85 to-card/70 p-5 ${className || ''}`}>
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 text-success shrink-0" />
          <div>
            <h3 className="text-base font-medium tracking-tight text-foreground">Check your inbox to confirm</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              We sent a confirmation link to <span className="text-foreground">{submittedEmail}</span>. Click it to activate your {digestLabel}.
            </p>
            {subscribedBoth ? (
              <p className="mt-1.5 text-xs text-muted-foreground/80">
                You&apos;ll receive separate confirmation emails for each digest.
              </p>
            ) : null}
            {message ? (
              <p className="mt-2 text-xs text-muted-foreground/80">{message}</p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground/70">
              Didn&apos;t receive it? Check your spam folder or{' '}
              <button
                type="button"
                onClick={() => { setStatus('idle'); setMessage(''); setSubscribedBoth(false); }}
                className="text-accent-info hover:text-accent-info/80 underline underline-offset-2"
              >
                try again
              </button>.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Already confirmed state
  if (status === 'already') {
    return (
      <section className={`rounded-2xl border border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/85 to-card/70 p-5 ${className || ''}`}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-success shrink-0" />
          <div>
            <h3 className="text-base font-medium tracking-tight text-foreground">You&apos;re already subscribed</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="text-foreground">{submittedEmail}</span> is already receiving the {regionLabel} Signal Feed digest.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-accent-info/25 bg-gradient-to-br from-accent-info/10 via-card/85 to-card/70 p-5 ${className || ''}`}>
      <p className="label-xs text-accent-info">
        {region === 'turkey' ? 'Turkey Signal Feed' : 'Daily Startup Digest'}
      </p>
      <h3 className="mt-2 text-xl font-medium tracking-tight text-foreground">Get top stories by daily popularity</h3>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Each day we send a ranked digest with cross-source signals and a short builder takeaway.
      </p>

      <form className="mt-4 flex flex-col gap-3 md:flex-row md:items-center" onSubmit={onSubmit}>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="h-10 min-w-0 flex-1 rounded-md border border-border/60 bg-background/80 px-3 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground/80 focus:border-accent-info/60"
        />
        <button
          type="submit"
          disabled={status === 'saving'}
          className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === 'saving' ? 'Subscribing...' : 'Subscribe'}
        </button>
      </form>

      <div className="mt-2 flex flex-col gap-1">
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={builderFocus}
            onChange={(event) => setBuilderFocus(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-border/60 bg-background/80"
          />
          Prioritize builder-focused takeaways in digest
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeOtherRegion}
            onChange={(event) => setIncludeOtherRegion(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-border/60 bg-background/80"
          />
          {region === 'turkey'
            ? 'Also receive the Global startup digest'
            : 'Include Turkey startup ecosystem signals'}
        </label>
      </div>

      {message && status === 'error' ? (
        <p className="mt-3 text-xs text-destructive">{message}</p>
      ) : null}
    </section>
  );
}

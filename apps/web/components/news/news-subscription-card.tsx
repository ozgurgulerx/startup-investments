'use client';

import { FormEvent, useState } from 'react';

interface NewsSubscriptionCardProps {
  className?: string;
}

export function NewsSubscriptionCard({ className }: NewsSubscriptionCardProps) {
  const [email, setEmail] = useState('');
  const [builderFocus, setBuilderFocus] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setMessage('');

    try {
      const res = await fetch('/api/news/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          builderFocus,
          source: 'news-module',
        }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(body.error || 'Failed to subscribe');
      }
      setStatus('done');
      setMessage(body.message || 'Subscribed');
      setEmail('');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Subscription failed');
    }
  }

  return (
    <section className={`rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/12 via-card/85 to-card/70 p-5 ${className || ''}`}>
      <p className="label-xs text-accent">Daily Startup Digest</p>
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
          className="h-10 min-w-0 flex-1 rounded-md border border-border/60 bg-background/80 px-3 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground/80 focus:border-accent/60"
        />
        <button
          type="submit"
          disabled={status === 'saving'}
          className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === 'saving' ? 'Subscribing...' : 'Subscribe'}
        </button>
      </form>

      <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={builderFocus}
          onChange={(event) => setBuilderFocus(event.target.checked)}
          className="h-3.5 w-3.5 rounded border-border/60 bg-background/80"
        />
        Prioritize builder-focused takeaways in digest
      </label>

      {message ? (
        <p className={`mt-3 text-xs ${status === 'done' ? 'text-success' : 'text-destructive'}`}>{message}</p>
      ) : null}
    </section>
  );
}

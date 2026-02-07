'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';
import { useAudience } from '@/lib/audience-context';
import { AudienceToggle } from '@/components/ui/audience-toggle';
import { COPY, SUPPORTING_LINE, METRICS, SIGN_IN_COPY } from '@/lib/copy';

function LoginPageContent() {
  const { audience } = useAudience();
  const copy = COPY[audience];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-border/30 relative overflow-hidden">
        {/* Subtle gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent/80 via-accent to-accent/40" />

        {/* Logo with accent dot */}
        <Link href="/" className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-base font-medium text-foreground tracking-tight">
            Build Atlas
          </span>
        </Link>

        {/* Value proposition */}
        <div className="space-y-8 max-w-md">
          {/* Audience Toggle */}
          <AudienceToggle />

          <div>
            <h1 className="text-4xl font-light tracking-tight text-foreground mb-4 leading-tight">
              {copy.heroHeadline}
            </h1>
            <p className="body-lg mb-6">
              {copy.heroSubhead}
            </p>
            <p className="text-sm text-muted-foreground/80">
              {SUPPORTING_LINE}
            </p>
          </div>

          {/* Stats with accent border */}
          <div className="flex gap-10 pt-6 border-t border-accent/30">
            <div>
              <p className="text-3xl font-light tabular-nums text-foreground">{METRICS.companies.value}</p>
              <p className="label-xs mt-1">{METRICS.companies.shortLabel}</p>
            </div>
            <div>
              <p className="text-3xl font-light tabular-nums text-accent">{METRICS.capital.value}</p>
              <p className="label-xs mt-1">{METRICS.capital.shortLabel}</p>
            </div>
            <div>
              <p className="text-3xl font-light tabular-nums text-foreground">{METRICS.patterns.value}</p>
              <p className="label-xs mt-1">{METRICS.patterns.shortLabel}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60">
          © 2026 Build Atlas
        </p>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <Link href="/" className="flex items-center gap-2 mb-10 lg:hidden">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-base font-medium text-foreground tracking-tight">
              Build Atlas
            </span>
          </Link>

          <div className="space-y-8">
            <div>
              <h2 className="headline-md mb-2">Sign in</h2>
              <p className="body-md">
                {SIGN_IN_COPY.subtitle}
              </p>
            </div>

            <Suspense fallback={<div className="h-40 animate-pulse bg-muted/30 rounded" />}>
              <LoginForm />
            </Suspense>

            <div className="pt-6 border-t border-border/30">
              <p className="body-sm text-center">
                Don&apos;t have an account?{' '}
                <Link href="/dealbook" className="text-foreground hover:text-accent-info transition-colors">
                  {copy.primaryCTA}
                </Link>
              </p>
            </div>
          </div>

          <p className="mt-10 text-center text-xs text-muted-foreground/60">
            By signing in, you agree to our{' '}
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 border border-border/50 rounded-full animate-pulse" />
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}

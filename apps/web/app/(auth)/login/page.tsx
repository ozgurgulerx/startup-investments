import { Suspense } from 'react';
import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';

function LoginPageContent() {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-border/30">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="text-base font-medium text-foreground tracking-tight">
            Build Patterns
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Intelligence
          </span>
        </Link>

        {/* Value proposition */}
        <div className="space-y-8 max-w-md">
          <div>
            <h1 className="headline-xl mb-4">
              AI Startup Intelligence
            </h1>
            <p className="body-lg">
              Monthly analysis of AI startup funding, build patterns, and market trends.
              Data-driven insights for investors and founders.
            </p>
          </div>

          {/* Stats */}
          <div className="flex gap-10 pt-6 border-t border-border/40">
            <div>
              <p className="num-lg text-foreground">$31.1B</p>
              <p className="label-xs mt-1">Capital Tracked</p>
            </div>
            <div>
              <p className="num-lg text-foreground">201</p>
              <p className="label-xs mt-1">Deals Analyzed</p>
            </div>
            <div>
              <p className="num-lg text-foreground">6</p>
              <p className="label-xs mt-1">Build Patterns</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60">
          © 2026 Build Patterns Intelligence
        </p>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <Link href="/" className="flex items-center gap-2 mb-10 lg:hidden">
            <span className="text-base font-medium text-foreground tracking-tight">
              Build Patterns
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Intelligence
            </span>
          </Link>

          <div className="space-y-8">
            <div>
              <h2 className="headline-md mb-2">Sign in</h2>
              <p className="body-md">
                Access your watchlist and personalized insights
              </p>
            </div>

            <Suspense fallback={<div className="h-40 animate-pulse bg-muted/30 rounded" />}>
              <LoginForm />
            </Suspense>

            <div className="pt-6 border-t border-border/30">
              <p className="body-sm text-center">
                Don&apos;t have an account?{' '}
                <Link href="/brief" className="text-foreground hover:text-accent transition-colors">
                  Browse as guest
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

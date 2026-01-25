'use client';

import { Suspense } from 'react';
import { motion } from 'framer-motion';
import { Layers, Sparkles, TrendingUp, Building2 } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { Card } from '@/components/ui/card';

function LoginPageContent() {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Branding (hidden on mobile) */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Layers className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="text-lg font-semibold">Build Patterns</span>
            <span className="text-sm text-muted-foreground ml-2">Intelligence</span>
          </div>
        </div>

        {/* Value proposition */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight glow-text-subtle">
              AI Startup
              <br />
              Intelligence
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-md">
              Monthly analysis of AI startup funding, build patterns, and market trends.
              Data-driven insights for investors and founders.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="space-y-4">
            {[
              { icon: Building2, text: 'Track 100+ AI startups monthly' },
              { icon: TrendingUp, text: 'Analyze funding patterns & trends' },
              { icon: Sparkles, text: 'Discover emerging build patterns' },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="flex items-center gap-3 text-muted-foreground"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <span>{item.text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Testimonial/social proof */}
        <div className="relative z-10 text-sm text-muted-foreground">
          <p className="italic">&ldquo;The most comprehensive AI startup intelligence platform.&rdquo;</p>
          <p className="mt-2 text-xs opacity-60">Trusted by VCs and founders worldwide</p>
        </div>
      </motion.div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Layers className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">Build Patterns Intelligence</span>
          </div>

          <Card className="p-8 glow-card border-border/50">
            <div className="space-y-6">
              <div className="text-center lg:text-left">
                <h2 className="text-2xl font-semibold">Welcome back</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sign in to access AI startup intelligence
                </p>
              </div>

              <Suspense fallback={<div className="h-40 animate-pulse bg-muted rounded-lg" />}>
                <LoginForm />
              </Suspense>
            </div>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            By signing in, you agree to our{' '}
            <a href="/terms" className="text-primary hover:underline">Terms</a>
            {' '}and{' '}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}

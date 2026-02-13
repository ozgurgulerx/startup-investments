'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { Suspense, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

// PostHog configuration
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseSampleRate(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

const REPLAY_SAMPLE_STORAGE_KEY = 'ba_posthog_replay_sampled';
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_AUTOCAPTURE_ENABLED = parseBooleanEnv(process.env.NEXT_PUBLIC_POSTHOG_AUTOCAPTURE, false);
const POSTHOG_CAPTURE_PAGELEAVE = parseBooleanEnv(process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_PAGELEAVE, false);
const POSTHOG_CAPTURE_DEAD_CLICKS = parseBooleanEnv(process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_DEAD_CLICKS, false);
const POSTHOG_CAPTURE_EXCEPTIONS = parseBooleanEnv(process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_EXCEPTIONS, true);
const POSTHOG_REPLAY_SAMPLE_RATE = parseSampleRate(process.env.NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE, 0.03);

function shouldSampleReplay(rate: number): boolean {
  if (typeof window === 'undefined' || rate <= 0) return false;
  try {
    const existing = window.sessionStorage.getItem(REPLAY_SAMPLE_STORAGE_KEY);
    if (existing === '1') return true;
    if (existing === '0') return false;
    const sampled = Math.random() < rate;
    window.sessionStorage.setItem(REPLAY_SAMPLE_STORAGE_KEY, sampled ? '1' : '0');
    return sampled;
  } catch {
    return Math.random() < rate;
  }
}

/**
 * PostHog page view tracker for Next.js App Router
 */
function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname && posthog.__loaded) {
      // Avoid useSearchParams() to prevent Next.js build-time CSR bailout errors.
      // window.location.href includes query string and hash.
      const url = window.location.href;
      posthog.capture('$pageview', { $current_url: url });
    }
  }, [pathname]);

  return null;
}

/**
 * Identify users when they log in via NextAuth
 */
function PostHogUserIdentifier() {
  const { data: session, status } = useSession();
  const posthogClient = usePostHog();

  useEffect(() => {
    if (status === 'authenticated' && session?.user && posthogClient) {
      posthogClient.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      });
    } else if (status === 'unauthenticated' && posthogClient) {
      posthogClient.reset();
    }
  }, [session, status, posthogClient]);

  return null;
}

/**
 * PostHog provider wrapper for Next.js
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Only initialize on client side and if key is available
    if (typeof window !== 'undefined' && POSTHOG_KEY && !posthog.__loaded) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        person_profiles: 'identified_only',
        autocapture: POSTHOG_AUTOCAPTURE_ENABLED,
        capture_dead_clicks: POSTHOG_CAPTURE_DEAD_CLICKS,
        rageclick: POSTHOG_CAPTURE_DEAD_CLICKS,
        capture_exceptions: POSTHOG_CAPTURE_EXCEPTIONS,
        capture_pageview: false, // We capture manually for Next.js
        capture_pageleave: POSTHOG_CAPTURE_PAGELEAVE,
        // Keep baseline usage low and only enable replay for sampled sessions.
        disable_session_recording: true,
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true, email: true, tel: true },
          recordHeaders: false,
          recordBody: false,
          collectFonts: false,
          recordCrossOriginIframes: false,
        },
        // DO NOT respect DNT - we want to track all users
        respect_dnt: false,
        // Persistence
        persistence: 'localStorage+cookie',
        // Debug mode in development
        loaded: (posthogClient) => {
          if (POSTHOG_REPLAY_SAMPLE_RATE > 0 && shouldSampleReplay(POSTHOG_REPLAY_SAMPLE_RATE)) {
            posthogClient.startSessionRecording({ sampling: true });
            posthogClient.register({ replay_sampled: true });
          } else {
            posthogClient.register({ replay_sampled: false });
          }
          if (process.env.NODE_ENV === 'development') {
            posthogClient.debug();
          }
          setIsInitialized(true);
        },
      });
    } else if (posthog.__loaded) {
      setIsInitialized(true);
    }
  }, []);

  // Don't render PostHog components if no key is configured
  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      {isInitialized && (
        <>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <PostHogUserIdentifier />
        </>
      )}
      {children}
    </PHProvider>
  );
}

/**
 * Track custom events
 *
 * Usage:
 *   import { trackEvent } from '@/lib/posthog';
 *   trackEvent('startup_viewed', { slug: 'acme-ai', funding: 10000000 });
 */
export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.capture(eventName, properties);
  }
}

/**
 * Identify a user (call after login)
 *
 * Usage:
 *   import { identifyUser } from '@/lib/posthog';
 *   identifyUser(user.id, { email: user.email, name: user.name });
 */
export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>
) {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.identify(userId, properties);
  }
}

/**
 * Reset user identity (call after logout)
 */
export function resetUser() {
  if (typeof window !== 'undefined' && posthog.__loaded) {
    posthog.reset();
  }
}

export { posthog };

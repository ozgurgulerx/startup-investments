'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// Initialize PostHog only on client side
if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false, // We capture manually for Next.js
    capture_pageleave: true,
    // Session recording (enabled by default on PostHog cloud)
    disable_session_recording: false,
    // Respect Do Not Track
    respect_dnt: true,
    // Persistence
    persistence: 'localStorage+cookie',
  });
}

/**
 * PostHog page view tracker for Next.js App Router
 */
function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      if (searchParams?.toString()) {
        url = url + '?' + searchParams.toString();
      }
      posthog.capture('$pageview', { $current_url: url });
    }
  }, [pathname, searchParams]);

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
      // Identify user when they log in
      posthogClient.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      });
    } else if (status === 'unauthenticated' && posthogClient) {
      // Reset when user logs out
      posthogClient.reset();
    }
  }, [session, status, posthogClient]);

  return null;
}

/**
 * PostHog provider wrapper for Next.js
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Don't render PostHog if no key is configured
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogUserIdentifier />
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
  if (typeof window !== 'undefined' && posthog) {
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
  if (typeof window !== 'undefined' && posthog) {
    posthog.identify(userId, properties);
  }
}

/**
 * Reset user identity (call after logout)
 */
export function resetUser() {
  if (typeof window !== 'undefined' && posthog) {
    posthog.reset();
  }
}

export { posthog };

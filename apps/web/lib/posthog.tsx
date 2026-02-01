'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// PostHog configuration
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

/**
 * PostHog page view tracker for Next.js App Router
 */
function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && posthog.__loaded) {
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
        capture_pageview: false, // We capture manually for Next.js
        capture_pageleave: true,
        // Session recording
        disable_session_recording: false,
        // DO NOT respect DNT - we want to track all users
        respect_dnt: false,
        // Persistence
        persistence: 'localStorage+cookie',
        // Debug mode in development
        loaded: (posthog) => {
          if (process.env.NODE_ENV === 'development') {
            posthog.debug();
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

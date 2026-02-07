'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRegion } from '@/lib/region-context';
import { normalizeDatasetRegion } from '@/lib/region';

const REGION_AWARE_PREFIXES = ['/brief', '/dealbook', '/signals', '/capital', '/company'];

function isRegionAwarePath(pathname: string): boolean {
  return REGION_AWARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Keep URL `?region=` and localStorage-backed region selection in sync.
 *
 * Server Components read `searchParams.region`, while the toggle reads localStorage.
 * Without this, users can see "Turkey" selected but still render Global (or vice versa).
 *
 * Rule:
 * - If the URL has `region`, URL wins (we persist it to localStorage).
 * - If the URL has no `region`, localStorage wins on region-aware routes (we add/remove `region`).
 */
export function RegionUrlSync() {
  const { region, setRegion, isLoaded } = useRegion();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    if (typeof window === 'undefined') return;

    const sync = () => {
      const pathname = window.location.pathname || '/';
      if (!isRegionAwarePath(pathname)) return;

      const params = new URLSearchParams(window.location.search || '');
      const rawUrlRegion = params.get('region');
      const urlRegion = rawUrlRegion ? normalizeDatasetRegion(rawUrlRegion) : 'global';

      // URL wins when present: align localStorage/ctx to URL.
      if (rawUrlRegion) {
        if (urlRegion !== region) {
          setRegion(urlRegion);
          return;
        }

        // If URL is present but normalizes to global, clean it up to avoid confusion.
        if (urlRegion === 'global') {
          params.delete('region');
          const qs = params.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
          router.refresh();
        }
        return;
      }

      // No URL region: localStorage wins for region-aware routes.
      if (region !== 'global') {
        params.set('region', region);
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
        router.refresh();
      }
    };

    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [isLoaded, region, setRegion, router]);

  return null;
}

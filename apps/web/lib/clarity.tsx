'use client';

import { useEffect } from 'react';

const CLARITY_PROJECT_ID = (process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || '').trim();
const CLARITY_SCRIPT_ID = 'buildatlas-clarity-script';

export function ClarityProvider() {
  useEffect(() => {
    if (!CLARITY_PROJECT_ID || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (document.getElementById(CLARITY_SCRIPT_ID)) {
      return;
    }

    const win = window as Window & {
      clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
    };

    if (!win.clarity) {
      const fn = ((...args: unknown[]) => {
        if (fn.q) fn.q.push(args);
      }) as ((...args: unknown[]) => void) & { q?: unknown[][] };
      fn.q = [];
      win.clarity = fn;
    }

    const script = document.createElement('script');
    script.id = CLARITY_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }, []);

  return null;
}

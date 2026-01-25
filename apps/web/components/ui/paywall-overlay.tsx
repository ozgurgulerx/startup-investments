'use client';

import { useEntitlement, PLAN_INFO, type Feature } from '@/lib/entitlement';
import Link from 'next/link';

interface PaywallOverlayProps {
  feature: Feature;
  children: React.ReactNode;
  previewMode?: 'blur' | 'fade' | 'lock';
  className?: string;
}

export function PaywallOverlay({
  feature,
  children,
  previewMode = 'blur',
  className = '',
}: PaywallOverlayProps) {
  const { canAccess, plan } = useEntitlement();

  if (canAccess(feature)) {
    return <>{children}</>;
  }

  const proFeatures = PLAN_INFO.pro.features.slice(0, 4);

  return (
    <div className={`relative ${className}`}>
      {/* Preview content with effect */}
      <div
        className={`
          ${previewMode === 'blur' ? 'blur-sm' : ''}
          ${previewMode === 'fade' ? 'opacity-30' : ''}
          ${previewMode === 'lock' ? 'opacity-20' : ''}
          pointer-events-none select-none
        `}
      >
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
        <div className="max-w-sm text-center px-6 py-8">
          {/* Lock icon */}
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-muted/50 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>

          <h3 className="text-lg font-medium text-foreground mb-2">
            Upgrade to Pro
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Get full access to this feature and more.
          </p>

          {/* Feature list */}
          <ul className="text-left text-sm space-y-2 mb-6">
            {proFeatures.map((feat) => (
              <li key={feat} className="flex items-center gap-2 text-muted-foreground">
                <svg className="w-4 h-4 text-accent flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{feat}</span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <Link
            href="/#pricing"
            className="inline-flex items-center justify-center px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
          >
            Upgrade Now
          </Link>

          {plan === 'free' && (
            <p className="mt-3 text-xs text-muted-foreground">
              Starting at $49/month
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple locked section indicator (inline, no overlay)
export function LockedBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Pro
    </span>
  );
}

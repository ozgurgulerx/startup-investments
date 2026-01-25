'use client';

import { type Feature } from '@/lib/entitlement';

interface PaywallOverlayProps {
  feature: Feature;
  children: React.ReactNode;
  previewMode?: 'blur' | 'fade' | 'lock';
  className?: string;
}

// All features are currently open - this component just renders children
export function PaywallOverlay({
  children,
}: PaywallOverlayProps) {
  return <>{children}</>;
}

// Badge component removed - no longer needed
export function LockedBadge({ className = '' }: { className?: string }) {
  return null;
}

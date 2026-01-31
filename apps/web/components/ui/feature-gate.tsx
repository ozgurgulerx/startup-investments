'use client';

import { ReactNode } from 'react';
import {
  hasFeatureAccess,
  getUpgradePrompt,
  type Feature,
  type UserPlan,
} from '@/lib/feature-flags';
import { Lock } from 'lucide-react';
import { Button } from './button';

/**
 * Feature gate component props
 */
export interface FeatureGateProps {
  /**
   * The feature being gated
   */
  feature: Feature;
  /**
   * User's current plan
   */
  plan: UserPlan | undefined;
  /**
   * Children to render if feature is accessible
   */
  children: ReactNode;
  /**
   * Optional fallback to render instead of default upgrade prompt
   */
  fallback?: ReactNode;
  /**
   * If true, always show children but apply styling to indicate it's gated
   */
  showPreview?: boolean;
  /**
   * Optional class name
   */
  className?: string;
}

/**
 * Default upgrade prompt card
 */
function UpgradePromptCard({ feature }: { feature: Feature }) {
  const prompt = getUpgradePrompt(feature);

  return (
    <div className="p-6 rounded-lg border border-border/50 bg-muted/10 text-center">
      <div className="flex justify-center mb-4">
        <div className="p-3 rounded-full bg-muted/30">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">{prompt.title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
        {prompt.description}
      </p>
      <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground">
        {prompt.cta}
      </Button>
    </div>
  );
}

/**
 * Feature gate component
 *
 * Wraps content that requires a specific plan level to access.
 * Shows an upgrade prompt if the user doesn't have access.
 */
export function FeatureGate({
  feature,
  plan,
  children,
  fallback,
  showPreview = false,
  className = '',
}: FeatureGateProps) {
  const hasAccess = hasFeatureAccess(plan, feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  // Show preview with overlay
  if (showPreview) {
    return (
      <div className={`relative ${className}`}>
        <div className="opacity-50 pointer-events-none blur-sm">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          {fallback || <UpgradePromptCard feature={feature} />}
        </div>
      </div>
    );
  }

  // Show fallback or default upgrade prompt
  return <div className={className}>{fallback || <UpgradePromptCard feature={feature} />}</div>;
}

/**
 * Inline feature gate for small UI elements
 */
export interface InlineFeatureGateProps {
  feature: Feature;
  plan: UserPlan | undefined;
  children: ReactNode;
  /**
   * Tooltip message when hovering over locked content
   */
  tooltip?: string;
}

export function InlineFeatureGate({
  feature,
  plan,
  children,
  tooltip,
}: InlineFeatureGateProps) {
  const hasAccess = hasFeatureAccess(plan, feature);

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground cursor-not-allowed"
      title={tooltip || getUpgradePrompt(feature).title}
    >
      <Lock className="h-3 w-3" />
      <span className="line-through opacity-50">{children}</span>
    </span>
  );
}

/**
 * Hook-style feature check for conditional rendering
 */
export function useFeatureAccess(plan: UserPlan | undefined, feature: Feature): boolean {
  return hasFeatureAccess(plan, feature);
}

export function isDecisionCardsEnabled(): boolean {
  if (typeof window !== 'undefined') {
    try {
      const ov = localStorage.getItem('buildatlas:radar-decision-cards');
      if (ov === 'true') return true;
      if (ov === 'false') return false;
    } catch {
      // Ignore storage access errors and fall back to env/default.
    }
  }
  return process.env.NEXT_PUBLIC_RADAR_DECISION_CARDS === 'true';
}

function readBooleanOverride(storageKey: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const ov = localStorage.getItem(storageKey);
    if (ov === 'true') return true;
    if (ov === 'false') return false;
  } catch {
    return null;
  }
  return null;
}

function readFlag(storageKey: string, envValue: string | undefined, defaultValue: boolean): boolean {
  const override = readBooleanOverride(storageKey);
  if (override !== null) return override;
  if (envValue === 'true') return true;
  if (envValue === 'false') return false;
  return defaultValue;
}

export function isSignalsUiFocusedModeEnabled(): boolean {
  return readFlag(
    'buildatlas:signals-ui-focused-mode',
    process.env.NEXT_PUBLIC_SIGNALS_UI_FOCUSED_MODE,
    true,
  );
}

export function isSignalsStaticFallbackDisabled(): boolean {
  return readFlag(
    'buildatlas:signals-disable-static-fallback',
    process.env.NEXT_PUBLIC_SIGNALS_DISABLE_STATIC_FALLBACK,
    true,
  );
}

export function isNewsSignalLinksEnabled(): boolean {
  return readFlag(
    'buildatlas:news-signal-links-enabled',
    process.env.NEXT_PUBLIC_NEWS_SIGNAL_LINKS_ENABLED,
    true,
  );
}

export function isRecoUxSimplifiedEnabled(): boolean {
  return readFlag(
    'buildatlas:reco-ux-simplified',
    process.env.NEXT_PUBLIC_RECO_UX_SIMPLIFIED,
    true,
  );
}

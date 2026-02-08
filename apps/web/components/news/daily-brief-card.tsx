'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronUp, X, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DailyNewsBrief } from '@startup-intelligence/shared';

interface DailyBriefCardProps {
  brief: DailyNewsBrief;
  onDismiss: () => void;
}

const AUTO_MINIMIZE_DELAY = 5000;
const RECOLLAPSE_DELAY = 1500;
const PEEK_HEIGHT = 40;

export function DailyBriefCard({ brief, onDismiss }: DailyBriefCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [autoMinimized, setAutoMinimized] = useState(false);
  const [userExpanded, setUserExpanded] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringRef = useRef(false);

  const bullets = (brief.bullets || []).slice(0, 4).filter(Boolean);
  const themes = (brief.themes || []).slice(0, 6).filter(Boolean);
  const isMinimized = autoMinimized && !userExpanded;

  const updatedTime = brief.generated_at
    ? new Date(brief.generated_at).toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  // Auto-minimize after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setAutoMinimized(true);
      if (isHoveringRef.current) setUserExpanded(true);
    }, AUTO_MINIMIZE_DELAY);
    return () => clearTimeout(timer);
  }, []);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const startCollapseTimer = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      setUserExpanded(false);
      setExpanded(false);
    }, RECOLLAPSE_DELAY);
  }, [clearCollapseTimer]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  const handleMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    if (autoMinimized) {
      clearCollapseTimer();
      setUserExpanded(true);
    }
  }, [autoMinimized, clearCollapseTimer]);

  const handleMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    if (autoMinimized) {
      startCollapseTimer();
    }
  }, [autoMinimized, startCollapseTimer]);

  const handlePeekClick = useCallback(() => {
    clearCollapseTimer();
    setUserExpanded(true);
  }, [clearCollapseTimer]);

  const handleMinimize = useCallback(() => {
    setUserExpanded(false);
    setExpanded(false);
  }, []);

  return (
    <motion.section
      initial={false}
      animate={{ height: isMinimized ? PEEK_HEIGHT : 'auto' }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      className={`my-2 overflow-hidden rounded-xl border border-accent-info/20 bg-gradient-to-br from-accent-info/8 via-card/80 to-card/50 transition-colors ${isMinimized ? 'cursor-pointer hover:border-accent-info/30' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={isMinimized ? handlePeekClick : undefined}
    >
      {/* Peek bar — always visible */}
      <div
        className={`flex items-center justify-between gap-3 px-4 ${isMinimized ? '' : 'pt-4'}`}
        style={isMinimized ? { height: PEEK_HEIGHT } : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          <p className="label-xs text-accent-info flex-shrink-0 whitespace-nowrap">
            Today&apos;s Briefing
          </p>
          {isMinimized ? (
            <p className="truncate text-sm font-light text-foreground/60">
              {brief.headline}
            </p>
          ) : (updatedTime || brief.cluster_count) ? (
            <p className="text-[10px] text-muted-foreground/60">
              {brief.cluster_count ? `${brief.cluster_count} stories` : null}
              {brief.cluster_count && updatedTime ? ' · ' : null}
              {updatedTime ? `Updated ${updatedTime}` : null}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isMinimized && brief.cluster_count ? (
            <span className="hidden sm:inline text-[10px] text-muted-foreground/60">
              {brief.cluster_count} stories
            </span>
          ) : null}
          {isMinimized ? (
            <ChevronDown className="h-3 w-3 text-accent-info/40" />
          ) : null}
          {!isMinimized && autoMinimized ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleMinimize(); }}
              className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
              aria-label="Minimize briefing"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            aria-label="Dismiss briefing"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Full content — clipped by overflow when minimized */}
      <div className="px-4 pb-4">
        <h2 className="mt-2 text-lg font-light leading-snug tracking-tight text-foreground">
          {brief.headline}
        </h2>

        {brief.summary ? (
          <p className={`mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
            {brief.summary}
          </p>
        ) : null}

        {expanded && bullets.length ? (
          <ul className="mt-3 space-y-1.5">
            {bullets.map((bullet, idx) => (
              <li
                key={`${idx}-${bullet.slice(0, 24)}`}
                className="flex items-start gap-2.5 text-sm text-foreground/85"
              >
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-info/60" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          {themes.length ? (
            <div className="flex flex-wrap gap-1.5">
              {themes.map((theme) => (
                <span
                  key={theme}
                  className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                >
                  {theme}
                </span>
              ))}
            </div>
          ) : <div />}

          {bullets.length ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex flex-shrink-0 items-center gap-1 text-[11px] text-accent-info/70 transition-colors hover:text-accent-info"
            >
              {expanded ? (
                <>Show less <ChevronUp className="h-3 w-3" /></>
              ) : (
                <>Read more <ChevronDown className="h-3 w-3" /></>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}

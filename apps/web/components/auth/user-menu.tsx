'use client';

import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
  User,
  Settings,
  LogOut,
  ChevronDown,
  Bookmark,
  LogIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (status === 'loading') {
    return (
      <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
    );
  }

  if (!session?.user) {
    return (
      <Link href="/login">
        <Button size="sm" className="gap-2">
          <LogIn className="h-4 w-4" />
          Sign In
        </Button>
      </Link>
    );
  }

  const initials = session.user.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session.user.email?.slice(0, 2).toUpperCase() || '??';

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 rounded-lg p-1.5 pr-3 transition-colors',
          'hover:bg-muted/50',
          isOpen && 'bg-muted/50'
        )}
      >
        {/* Avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium overflow-hidden">
          {session.user.image ? (
            <img
              src={session.user.image}
              alt={session.user.name || ''}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <ChevronDown className={cn(
          'h-4 w-4 text-muted-foreground transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-border bg-card p-1 shadow-xl"
            >
              {/* User info */}
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-sm font-medium truncate">{session.user.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {session.user.email}
                </p>
              </div>

              {/* Menu items */}
              <MenuItem
                href="/watchlist"
                icon={Bookmark}
                onClick={() => setIsOpen(false)}
              >
                Watchlist
              </MenuItem>
              <MenuItem
                href="/settings/profile"
                icon={User}
                onClick={() => setIsOpen(false)}
              >
                Profile
              </MenuItem>
              <MenuItem
                href="/settings"
                icon={Settings}
                onClick={() => setIsOpen(false)}
              >
                Settings
              </MenuItem>

              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  href,
  icon: Icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <Icon className="h-4 w-4" />
      {children}
    </Link>
  );
}

// Compact version for sidebar
export function UserProfileSection() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-1">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-3 w-32 bg-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Link href="/login" className="w-full">
        <Button variant="outline" className="w-full justify-start gap-3">
          <LogIn className="h-4 w-4" />
          Sign In
        </Button>
      </Link>
    );
  }

  const initials = session.user.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '??';

  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium overflow-hidden">
        {session.user.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || ''}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{session.user.name}</p>
        <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
      </div>
    </div>
  );
}

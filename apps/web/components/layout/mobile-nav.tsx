'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sheet, SheetHeader, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';

interface NavItem {
  label: string;
  href: string;
  showBadge?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Brief', href: '/brief' },
  { label: 'Dossiers', href: '/dealbook' },
  { label: 'Signals', href: '/signals' },
  { label: 'Capital', href: '/capital' },
  { label: 'Library', href: '/library' },
  { label: 'Watchlist', href: '/watchlist', showBadge: true },
];

export function MobileNavTrigger() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted/50 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen} side="left" className="bg-background">
        <div className="flex h-full flex-col bg-background">
          <SheetHeader onClose={() => setOpen(false)} className="bg-background">
            <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
              <span className="w-2 h-2 rounded-full bg-accent" />
              <span className="text-sm font-medium text-foreground tracking-tight">
                Build Atlas
              </span>
            </Link>
          </SheetHeader>

          <SheetContent className="flex-1 px-4 py-6 bg-background">
            <nav className="space-y-2">
              {navItems.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block px-4 py-3 text-base rounded-md transition-colors',
                      isActive
                        ? 'text-foreground bg-muted/60 font-medium'
                        : 'text-foreground/80 hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span>{item.label}</span>
                      {item.showBadge && <WatchlistBadge />}
                    </div>
                  </Link>
                );
              })}
            </nav>
          </SheetContent>

          <div className="px-6 py-6 border-t border-border/50 bg-background">
            <p className="text-xs text-muted-foreground">
              January 2026
            </p>
          </div>
        </div>
      </Sheet>
    </>
  );
}

import { cn } from '@/lib/utils';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  variant?: 'default' | 'accent' | 'muted';
  className?: string;
}

const containerSizes = {
  sm: 'gap-2',
  md: 'gap-2.5',
  lg: 'gap-3',
} as const;

const symbolSizes = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
  lg: 'h-8 w-8',
} as const;

const wordSizes = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
} as const;

const logoSrc = {
  sm: '/buildatlas-navbar-mark.svg',
  md: '/buildatlas-site-mark.svg',
  lg: '/buildatlas-site-mark.svg',
} as const;

export function BrandMark({
  size = 'md',
  showWordmark = true,
  variant = 'default',
  className,
}: BrandMarkProps) {
  return (
    <span className={cn('inline-flex items-center', containerSizes[size], className)}>
      <span
        className={cn('relative inline-flex items-center justify-center', symbolSizes[size])}
        aria-hidden
      >
        <img
          src={logoSrc[size]}
          alt=""
          className="h-full w-full"
        />
      </span>
      {showWordmark && (
        <span
          className={cn(
            'font-medium tracking-[0.01em] leading-none text-foreground',
            wordSizes[size]
          )}
        >
          Build Atlas
        </span>
      )}
    </span>
  );
}

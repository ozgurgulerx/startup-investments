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

const variantClasses = {
  default: {
    frame: 'border-border/50 bg-card/70 text-foreground',
    dot: 'fill-accent',
  },
  accent: {
    frame: 'border-accent/45 bg-accent/10 text-foreground',
    dot: 'fill-accent',
  },
  muted: {
    frame: 'border-border/35 bg-muted/40 text-muted-foreground',
    dot: 'fill-muted-foreground/80',
  },
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
        className={cn(
          'relative inline-flex items-center justify-center rounded-md border shadow-[0_0_0_1px_rgba(255,255,255,0.02)]',
          symbolSizes[size],
          variantClasses[variant].frame
        )}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]">
          <path
            d="M6 6h5v5H6V6Zm7 0h5v5h-5V6Zm-7 7h5v5H6v-5Zm7 0h5v5h-5v-5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <circle className={variantClasses[variant].dot} cx="9" cy="9" r="1.25" />
        </svg>
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

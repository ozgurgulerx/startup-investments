import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ContainerSize = 'default' | 'prose' | 'wide';

const SIZE_CLASS: Record<ContainerSize, string> = {
  default: 'max-w-6xl',
  prose: 'max-w-3xl',
  wide: 'max-w-7xl',
};

export function PageContainer({
  as,
  size = 'default',
  className,
  children,
}: {
  as?: ElementType;
  size?: ContainerSize;
  className?: string;
  children: ReactNode;
}) {
  const Component = as ?? 'div';
  return (
    <Component className={cn('mx-auto w-full px-6', SIZE_CLASS[size], className)}>
      {children}
    </Component>
  );
}

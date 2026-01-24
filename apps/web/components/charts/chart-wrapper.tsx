'use client';

import { ReactNode } from 'react';
import { ResponsiveContainer } from 'recharts';

interface ChartWrapperProps {
  children: ReactNode;
  height?: number;
  className?: string;
}

export function ChartWrapper({
  children,
  height = 300,
  className = ''
}: ChartWrapperProps) {
  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

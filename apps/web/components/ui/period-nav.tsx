'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { MonthSwitcher } from './month-switcher';

interface PeriodNavProps {
  availableMonths: string[];
  currentMonth: string;
  className?: string;
}

export function PeriodNav({ availableMonths, currentMonth, className }: PeriodNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (month: string) => {
      const params = new URLSearchParams(searchParams.toString());
      // If selecting the latest (first) month, remove the param for a clean URL
      if (month === availableMonths[0]) {
        params.delete('month');
      } else {
        params.set('month', month);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams, availableMonths],
  );

  return (
    <MonthSwitcher
      availableMonths={availableMonths}
      value={currentMonth}
      onChange={handleChange}
      className={className}
    />
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  searchParams?: Record<string, string | undefined>;
  className?: string;
}

/**
 * Generate page numbers to display with ellipsis for large page counts
 */
function getPageNumbers(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  const pages: (number | 'ellipsis')[] = [];
  const maxVisible = 7;

  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  // Always show first page
  pages.push(1);

  // Calculate range around current page
  let startPage = Math.max(2, currentPage - 1);
  let endPage = Math.min(totalPages - 1, currentPage + 1);

  // Adjust range if near start or end
  if (currentPage <= 3) {
    endPage = Math.min(5, totalPages - 1);
  } else if (currentPage >= totalPages - 2) {
    startPage = Math.max(2, totalPages - 4);
  }

  // Add ellipsis before if needed
  if (startPage > 2) {
    pages.push('ellipsis');
  }

  // Add page numbers
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  // Add ellipsis after if needed
  if (endPage < totalPages - 1) {
    pages.push('ellipsis');
  }

  // Always show last page
  if (totalPages > 1) {
    pages.push(totalPages);
  }

  return pages;
}

/**
 * Build URL with updated page parameter
 */
function buildPageUrl(
  baseUrl: string,
  page: number,
  searchParams?: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();

  // Add existing search params
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && key !== 'page') {
        params.set(key, value);
      }
    });
  }

  // Add page parameter (only if not page 1)
  if (page > 1) {
    params.set('page', page.toString());
  }

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  searchParams,
  className,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pageNumbers = getPageNumbers(currentPage, totalPages);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      {/* Previous button */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-8 w-8 p-0',
          !hasPrevious && 'pointer-events-none opacity-50'
        )}
        asChild={hasPrevious}
      >
        {hasPrevious ? (
          <Link
            href={buildPageUrl(baseUrl, currentPage - 1, searchParams)}
            aria-label="Go to previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
        ) : (
          <span>
            <ChevronLeft className="h-4 w-4" />
          </span>
        )}
      </Button>

      {/* Page numbers */}
      {pageNumbers.map((page, index) => {
        if (page === 'ellipsis') {
          return (
            <span
              key={`ellipsis-${index}`}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          );
        }

        const isActive = page === currentPage;

        return (
          <Button
            key={page}
            variant={isActive ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-8 w-8 p-0 tabular-nums',
              isActive && 'pointer-events-none'
            )}
            asChild={!isActive}
          >
            {isActive ? (
              <span aria-current="page">{page}</span>
            ) : (
              <Link
                href={buildPageUrl(baseUrl, page, searchParams)}
                aria-label={`Go to page ${page}`}
              >
                {page}
              </Link>
            )}
          </Button>
        );
      })}

      {/* Next button */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-8 w-8 p-0',
          !hasNext && 'pointer-events-none opacity-50'
        )}
        asChild={hasNext}
      >
        {hasNext ? (
          <Link
            href={buildPageUrl(baseUrl, currentPage + 1, searchParams)}
            aria-label="Go to next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span>
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </Button>
    </nav>
  );
}

/**
 * Pagination info text showing "Showing X-Y of Z results"
 */
export function PaginationInfo({
  currentPage,
  limit,
  total,
  className,
}: {
  currentPage: number;
  limit: number;
  total: number;
  className?: string;
}) {
  const start = (currentPage - 1) * limit + 1;
  const end = Math.min(currentPage * limit, total);

  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      Showing{' '}
      <span className="font-medium tabular-nums">{start}</span>
      {' '}-{' '}
      <span className="font-medium tabular-nums">{end}</span>
      {' '}of{' '}
      <span className="font-medium tabular-nums">{total}</span>
      {' '}results
    </p>
  );
}

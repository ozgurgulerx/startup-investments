'use client';

import { useEffect } from 'react';

export default function DealbookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dealbook page error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-lg font-medium text-foreground mb-2">
        Something went wrong loading the Dossiers
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        There was an issue loading the data. This is usually temporary.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

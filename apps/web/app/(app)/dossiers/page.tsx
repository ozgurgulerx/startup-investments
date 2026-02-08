import { redirect } from 'next/navigation';

/**
 * Legacy alias route.
 *
 * Users often refer to Dealbook as "Dossiers". Keep `/dossiers` working and
 * forward to `/dealbook`, preserving query parameters (e.g. `?region=turkey`).
 */
export default async function DossiersPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const spRaw = await Promise.resolve(props.searchParams ?? {});
  const params = new URLSearchParams();

  for (const [k, v] of Object.entries(spRaw)) {
    if (typeof v === 'string' && v) params.set(k, v);
    else if (Array.isArray(v) && v[0]) params.set(k, v[0]);
  }

  const qs = params.toString();
  redirect(qs ? `/dealbook/?${qs}` : '/dealbook/');
}


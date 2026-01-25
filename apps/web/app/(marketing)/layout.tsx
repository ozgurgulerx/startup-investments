import { EntitlementProvider } from '@/lib/entitlement';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EntitlementProvider>
      {children}
    </EntitlementProvider>
  );
}

import Link from 'next/link';
import { NewsNav } from '@/components/news/news-nav';
import { PageContainer } from '@/components/layout/page-container';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NewsNav activeRegion="global" activePeriod="daily" />

      {/* Content */}
      <main className="flex-1 py-12">
        <PageContainer size="prose">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>

          <h1 className="text-4xl font-light text-foreground mb-4">
            Support
          </h1>

          <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
            Found a bug, have a feature request, or need to flag a data correction?
            We read every message.
          </p>

          {/* Email CTA */}
          <div className="mb-12">
            <a
              href="mailto:support@graph-atlas.com"
              className="inline-flex items-center gap-3 px-6 py-3 rounded-lg border border-border/50 bg-muted/20 text-foreground hover:bg-muted/40 transition-colors"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <span className="text-base font-medium">support@graph-atlas.com</span>
            </a>
          </div>

          {/* What to include */}
          <div className="mb-12">
            <h2 className="text-lg font-medium text-foreground mb-4">
              What to include
            </h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span>Page URL where you encountered the issue</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span>What you expected vs. what happened</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span>Steps to reproduce (if reporting a bug)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                <span>Screenshot (optional but helpful)</span>
              </li>
            </ul>
          </div>
        </PageContainer>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-border/30">
        <PageContainer className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-sm font-medium text-foreground">Build Atlas</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-accent-info transition-colors">Methodology</Link>
            <Link href="/brief" className="hover:text-accent-info transition-colors">Brief</Link>
            <Link href="/dealbook" className="hover:text-accent-info transition-colors">Dossiers</Link>
            <Link href="/terms" className="hover:text-accent-info transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-accent-info transition-colors">Privacy</Link>
            <Link href="/support" className="text-foreground">Support</Link>
            <a href="mailto:support@graph-atlas.com" className="hover:text-accent-info transition-colors">support@graph-atlas.com</a>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Build Atlas
          </p>
        </PageContainer>
      </footer>
    </div>
  );
}

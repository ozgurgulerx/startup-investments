import Link from 'next/link';
import { NewsNav } from '@/components/news/news-nav';
import { PageContainer } from '@/components/layout/page-container';

export default function TermsPage() {
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

          <h1 className="text-4xl font-light text-foreground mb-6">
            Terms of Service
          </h1>

          <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
            Last updated: January 2026
          </p>

          <div className="space-y-12 text-muted-foreground">
            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">1. Acceptance of Terms</h2>
              <p className="leading-relaxed">
                By accessing and using Build Atlas, you agree to be bound by these Terms of Service.
                If you do not agree to these terms, please do not use our service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">2. Description of Service</h2>
              <p className="leading-relaxed mb-4">
                Build Atlas provides startup intelligence and analysis services, including:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Company dossiers with architecture, stack, and positioning analysis
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Monthly Brief reports on AI startup funding and trends
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Build pattern signals and market intelligence
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Capital flow tracking and analysis
                </li>
              </ul>
              <p className="leading-relaxed mt-4">
                All content is freely accessible. Signing in enables personalization features like
                watchlists and saved filters but is not required to browse.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">3. User Accounts</h2>
              <p className="leading-relaxed">
                Creating an account is optional. If you choose to create an account, you are
                responsible for maintaining the confidentiality of your login credentials.
                Account features include watchlists, saved filters, and personalized recommendations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">4. Acceptable Use</h2>
              <p className="leading-relaxed mb-4">
                You agree not to:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Use the service for any unlawful purpose
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Attempt to gain unauthorized access to our systems
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Scrape or bulk download content beyond reasonable personal use
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Redistribute our content commercially without permission
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">5. Intellectual Property</h2>
              <p className="leading-relaxed">
                All content on Build Atlas, including dossiers, briefs, and analysis, is protected
                by copyright. You may use our content for personal reference and research.
                Commercial redistribution requires written permission.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">6. Disclaimer</h2>
              <p className="leading-relaxed">
                Build Atlas provides information and analysis for educational and research purposes.
                Our content does not constitute investment advice. We make no guarantees about the
                accuracy, completeness, or timeliness of our data. Use at your own discretion.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">7. Limitation of Liability</h2>
              <p className="leading-relaxed">
                Build Atlas shall not be liable for any indirect, incidental, special, or
                consequential damages arising from your use of the service or reliance on any
                information provided.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">8. Changes to Terms</h2>
              <p className="leading-relaxed">
                We may update these terms from time to time. Continued use of the service after
                changes constitutes acceptance of the new terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">9. Contact</h2>
              <p className="leading-relaxed">
                For questions about these Terms of Service, please contact us at{' '}
                <a href="mailto:support@graph-atlas.com" className="text-accent-info hover:text-foreground transition-colors">support@graph-atlas.com</a>
                {' '}or visit our{' '}
                <Link href="/support" className="text-accent-info hover:text-foreground transition-colors">support page</Link>.
              </p>
            </section>
          </div>

          <div className="mt-16 p-6 bg-muted/10 border border-border/30 rounded-lg text-center">
            <p className="text-muted-foreground mb-4">
              Ready to explore?
            </p>
            <Link
              href="/dealbook"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Browse Dossiers
            </Link>
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
            <Link href="/terms" className="text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-accent-info transition-colors">Privacy</Link>
            <Link href="/support" className="hover:text-accent-info transition-colors">Support</Link>
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

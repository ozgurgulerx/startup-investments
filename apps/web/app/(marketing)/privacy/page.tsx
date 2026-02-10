import Link from 'next/link';
import { NewsNav } from '@/components/news/news-nav';
import { PageContainer } from '@/components/layout/page-container';

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>

          <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
            Last updated: January 2026
          </p>

          <div className="space-y-12 text-muted-foreground">
            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Overview</h2>
              <p className="leading-relaxed">
                Build Atlas is committed to protecting your privacy. This policy explains how we
                collect, use, and safeguard your information when you use our service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Information We Collect</h2>
              <p className="leading-relaxed mb-4">
                We collect minimal information necessary to provide our service:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  <strong className="text-foreground">Account information:</strong> Email address if you choose to create an account
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  <strong className="text-foreground">Usage data:</strong> Pages visited and features used to improve our service
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  <strong className="text-foreground">Preferences:</strong> Watchlist items and saved filters if you have an account
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">How We Use Your Information</h2>
              <p className="leading-relaxed mb-4">
                We use your information to:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Provide and maintain our service
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Save your watchlists and preferences
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Improve our content and features
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Send service-related communications (optional)
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Data Storage</h2>
              <p className="leading-relaxed">
                Your data is stored securely using industry-standard encryption. Watchlist data
                may be stored locally in your browser if you browse without an account.
                Account data is stored on secure servers.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Cookies</h2>
              <p className="leading-relaxed">
                We use essential cookies to maintain your session and preferences. We do not use
                cookies for tracking or advertising purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Third Parties</h2>
              <p className="leading-relaxed">
                We do not sell your personal information. We may use third-party services for
                authentication (Google OAuth) and analytics. These services have their own
                privacy policies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Your Rights</h2>
              <p className="leading-relaxed mb-4">
                You have the right to:
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Access your personal data
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Request deletion of your account and data
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Export your watchlist and preferences
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">-</span>
                  Opt out of non-essential communications
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Data Retention</h2>
              <p className="leading-relaxed">
                We retain your account data as long as your account is active. You may delete
                your account at any time, which will remove your personal data from our servers.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Changes to This Policy</h2>
              <p className="leading-relaxed">
                We may update this privacy policy from time to time. We will notify users of any
                significant changes through our website or email.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Contact</h2>
              <p className="leading-relaxed">
                For questions about this Privacy Policy or your personal data, please contact us
                through our website.
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
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-accent-info transition-colors">Methodology</Link>
            <Link href="/brief" className="hover:text-accent-info transition-colors">Brief</Link>
            <Link href="/dealbook" className="hover:text-accent-info transition-colors">Dossiers</Link>
            <Link href="/terms" className="hover:text-accent-info transition-colors">Terms</Link>
            <Link href="/privacy" className="text-foreground">Privacy</Link>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Build Atlas
          </p>
        </PageContainer>
      </footer>
    </div>
  );
}

import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border/30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-base font-medium text-foreground tracking-tight">
            Build Atlas
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/methodology" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Methodology
            </Link>
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 text-xs text-accent bg-accent/10 rounded-full">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            January 2026 Atlas Brief
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight text-foreground mb-6 leading-tight">
            How AI startups are really built.
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Build Atlas decodes funded AI startups into clear dossiers: product wedge,
            architecture, data moat, and go-to-market.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dealbook"
              className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Explore Dossiers
            </Link>
            <Link
              href="/brief"
              className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
            >
              Read the January Brief
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-12 border-y border-border/30 bg-muted/10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">201</p>
              <p className="text-sm text-muted-foreground mt-1">Companies Decoded</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">$31.1B</p>
              <p className="text-sm text-muted-foreground mt-1">Capital Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">6</p>
              <p className="text-sm text-muted-foreground mt-1">Architecture Patterns</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">55%</p>
              <p className="text-sm text-muted-foreground mt-1">GenAI Stack</p>
            </div>
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-light text-foreground mb-4">
              What You Get
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Browse highlights for free. Pro unlocks full dossiers, advanced filters, archives, and exports.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Atlas Brief</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A concise monthly thesis on what changed, why it matters, and the builder implications.
              </p>
            </div>

            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Company Dossiers</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Searchable company-level breakdowns with architecture, stack, positioning, and confidence-scored signals.
              </p>
            </div>

            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Architecture Signals</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Emerging build and stack signals detected across startups, with confidence levels and failure modes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sample Preview */}
      <section className="py-20 px-6 bg-muted/10 border-y border-border/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-light text-foreground mb-4">
              Analysis, Not Noise
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Every dossier is backed by evidence. Every signal is detected from real implementation data.
            </p>
          </div>

          {/* Mock Brief Preview */}
          <div className="max-w-3xl mx-auto p-8 bg-card border border-border/30 rounded-lg">
            <div className="label-xs text-muted-foreground mb-4">JANUARY 2026 ATLAS BRIEF</div>
            <h3 className="text-xl font-light text-foreground mb-4 leading-relaxed">
              Agentic architectures dominate new funding, with 55% of startups building
              on generative AI infrastructure and multi-model orchestration.
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Average deal size reached $154.6M. Capital is concentrating on fewer,
              more infrastructure-heavy plays. Builder implication: the middleware layer is heating up.
            </p>
            <div className="flex gap-8 pt-4 border-t border-border/30">
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">201</p>
                <p className="text-xs text-muted-foreground mt-1">Dossiers</p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">$31.1B</p>
                <p className="text-xs text-muted-foreground mt-1">Capital</p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">6</p>
                <p className="text-xs text-muted-foreground mt-1">Patterns</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sign In for Pro */}
      <section id="personalize" className="py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-3xl font-light text-foreground mb-4">
            Unlock Full Access
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
            Browse highlights for free. Pro unlocks full dossiers, advanced filters, archives, and exports.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/brief"
              className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
            >
              Continue Browsing
            </Link>
          </div>
        </div>
      </section>

      {/* Methodology Teaser */}
      <section className="py-20 px-6 bg-muted/10 border-y border-border/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-light text-foreground mb-4">
            How We Decode Startups
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Build Atlas combines automated data collection from 50+ sources with
            LLM-powered architecture detection. Every dossier includes evidence counts,
            confidence scores, and source attribution.
          </p>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-2 text-accent hover:text-accent/80 transition-colors"
          >
            Read our methodology
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-light text-foreground mb-12 text-center">
            Frequently Asked Questions
          </h2>

          <div className="space-y-6">
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">How often is Build Atlas updated?</h3>
              <p className="text-sm text-muted-foreground">
                We publish a new Atlas Brief by the 5th of each month covering the previous month.
                Company dossiers are refreshed continuously as new information surfaces.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">What funding stages do you cover?</h3>
              <p className="text-sm text-muted-foreground">
                Seed through Series D, with a focus on AI and AI-adjacent companies.
                We include deals $1M+ to maintain signal quality.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">How are architecture signals detected?</h3>
              <p className="text-sm text-muted-foreground">
                Our system analyzes company websites, documentation, job postings, and technical content
                to identify stack choices and architecture patterns. Each signal includes a confidence score.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">Can I export the data?</h3>
              <p className="text-sm text-muted-foreground">
                Pro users can export dossiers to CSV and download PDF briefs.
                Free users can browse highlights and summaries.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">What&apos;s the difference between free and Pro?</h3>
              <p className="text-sm text-muted-foreground">
                Free gives you access to highlights and the current month&apos;s brief summary.
                Pro unlocks full dossiers, advanced filters, historical archives, and data exports.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border/30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <span className="text-sm font-medium text-foreground">Build Atlas</span>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-foreground transition-colors">Methodology</Link>
            <Link href="/brief" className="hover:text-foreground transition-colors">Atlas Brief</Link>
            <Link href="/dealbook" className="hover:text-foreground transition-colors">Dossiers</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Build Atlas
          </p>
        </div>
      </footer>
    </div>
  );
}

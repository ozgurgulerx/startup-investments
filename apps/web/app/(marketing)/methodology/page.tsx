import Link from 'next/link';

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border/30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-base font-medium text-foreground tracking-tight">
              Build Patterns
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Intelligence
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
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
            Our Methodology
          </h1>

          <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
            Build Patterns Intelligence combines automated data collection, AI-powered analysis,
            and human editorial oversight to deliver actionable startup intelligence.
          </p>

          <div className="space-y-12">
            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Data Collection</h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                We continuously monitor 50+ data sources including funding announcements,
                company websites, technical documentation, blog posts, press releases,
                and industry publications. Our crawlers collect structured and unstructured
                data that feeds into our analysis pipeline.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Funding data from Crunchbase, PitchBook, and direct announcements
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Company websites and technical documentation
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  GitHub repositories and developer content
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Press releases and news coverage
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">AI-Powered Analysis</h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                Each company goes through a multi-stage analysis pipeline using large language models.
                We extract structured information, identify build patterns, assess GenAI intensity,
                and generate competitive positioning insights.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-4 border border-border/30 rounded-lg">
                  <h3 className="text-sm font-medium text-foreground mb-2">Pattern Detection</h3>
                  <p className="text-xs text-muted-foreground">
                    Identifies architectural patterns like Agentic Architectures, RAG,
                    Vertical Data Moats with confidence scores.
                  </p>
                </div>
                <div className="p-4 border border-border/30 rounded-lg">
                  <h3 className="text-sm font-medium text-foreground mb-2">GenAI Assessment</h3>
                  <p className="text-xs text-muted-foreground">
                    Classifies companies by GenAI integration depth: core, significant,
                    supplementary, or none.
                  </p>
                </div>
                <div className="p-4 border border-border/30 rounded-lg">
                  <h3 className="text-sm font-medium text-foreground mb-2">Competitive Analysis</h3>
                  <p className="text-xs text-muted-foreground">
                    Identifies competitors, differentiators, and defensibility factors
                    for each company.
                  </p>
                </div>
                <div className="p-4 border border-border/30 rounded-lg">
                  <h3 className="text-sm font-medium text-foreground mb-2">Evidence Extraction</h3>
                  <p className="text-xs text-muted-foreground">
                    Captures source quotes and citations to back every claim
                    with verifiable evidence.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Pattern Taxonomy</h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                Our pattern taxonomy represents recurring architectural decisions that signal
                how companies are building with AI. Each pattern includes:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <strong className="text-foreground">Definition:</strong> What the pattern means
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <strong className="text-foreground">What it enables:</strong> Business capabilities unlocked
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <strong className="text-foreground">Time horizon:</strong> Expected maturity timeline
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  <strong className="text-foreground">Primary risk:</strong> What could derail adoption
                </li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Current patterns include: Agentic Architectures, Vertical Data Moats,
                RAG (Retrieval-Augmented Generation), Micro-model Meshes,
                Continuous-learning Flywheels, and Guardrail-as-LLM.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Monthly Brief Process</h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                Each month, we synthesize individual company analyses into an intelligence brief:
              </p>
              <ol className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">1</span>
                  <span>Aggregate funding data and compute summary statistics</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">2</span>
                  <span>Identify pattern distribution and month-over-month changes</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">3</span>
                  <span>Generate thesis statement and implications using LLM synthesis</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">4</span>
                  <span>Human editorial review for accuracy and insight quality</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">5</span>
                  <span>Publish by the 5th of each month</span>
                </li>
              </ol>
            </section>

            <section>
              <h2 className="text-xl font-medium text-foreground mb-4">Trust & Transparency</h2>
              <p className="text-muted-foreground mb-4 leading-relaxed">
                Every company analysis includes:
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Evidence count showing how many source documents were analyzed
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Freshness timestamp indicating when data was last updated
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Source evidence quotes with citations
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent">•</span>
                  Confidence scores for pattern assignments
                </li>
              </ul>
            </section>
          </div>

          <div className="mt-16 p-6 bg-muted/10 border border-border/30 rounded-lg text-center">
            <p className="text-muted-foreground mb-4">
              Ready to explore AI startup intelligence?
            </p>
            <Link
              href="/brief"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border/30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Build Patterns</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Intelligence</span>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Build Patterns Intelligence
          </p>
        </div>
      </footer>
    </div>
  );
}

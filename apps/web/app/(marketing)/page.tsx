import Link from 'next/link';
import { PRICING, PLAN_INFO } from '@/lib/pricing';

export default function LandingPage() {
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
            <Link href="/methodology" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Methodology
            </Link>
            <Link href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link
              href="/brief"
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
            January 2026 Brief Available
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-light tracking-tight text-foreground mb-6 leading-tight">
            AI Startup Intelligence<br />
            <span className="text-muted-foreground">for Serious Investors</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Monthly analysis of 200+ AI startup funding rounds. Pattern detection,
            competitive signals, and evidence-backed insights — delivered in a format
            built for investment decisions.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/brief"
              className="px-8 py-3 text-base font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Subscribe Now
            </Link>
            <Link
              href="/brief"
              className="px-8 py-3 text-base font-medium text-foreground border border-border/50 rounded hover:bg-muted/30 transition-colors"
            >
              View Sample Brief
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-12 border-y border-border/30 bg-muted/10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">$31.1B</p>
              <p className="text-sm text-muted-foreground mt-1">Capital Tracked</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">201</p>
              <p className="text-sm text-muted-foreground mt-1">Deals Analyzed</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">55%</p>
              <p className="text-sm text-muted-foreground mt-1">GenAI Adoption</p>
            </div>
            <div>
              <p className="text-3xl font-light text-foreground tabular-nums">6</p>
              <p className="text-sm text-muted-foreground mt-1">Build Patterns</p>
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
              Every month, receive a comprehensive intelligence brief covering the AI startup ecosystem.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Monthly Brief</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Thesis-driven analysis of capital flows, dominant patterns, and market implications.
                Includes KPIs, notable rounds, and builder plays.
              </p>
            </div>

            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Full Dealbook</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Complete database of analyzed companies with advanced filters. Export to CSV,
                add to watchlist, and track across months.
              </p>
            </div>

            <div className="p-6 border border-border/30 rounded-lg">
              <div className="w-10 h-10 mb-4 rounded bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Pattern Signals</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI-detected build patterns with conviction levels, time horizons, and risk factors.
                See which architectures are gaining traction.
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
              Intelligence, Not Noise
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Every insight is backed by evidence. Every pattern is detected from real data.
            </p>
          </div>

          {/* Mock Brief Preview */}
          <div className="max-w-3xl mx-auto p-8 bg-card border border-border/30 rounded-lg">
            <div className="label-xs text-muted-foreground mb-4">JANUARY 2026 ANALYSIS</div>
            <h3 className="text-xl font-light text-foreground mb-4 leading-relaxed">
              Capital concentrated around agentic architectures, with 55% of funded startups
              building on generative AI infrastructure.
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Average deal size reached $154.6M, suggesting investors are concentrating bets
              on fewer, more capital-intensive infrastructure plays.
            </p>
            <div className="flex gap-8 pt-4 border-t border-border/30">
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">$31.1B</p>
                <p className="text-xs text-muted-foreground mt-1">Total Capital</p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">201</p>
                <p className="text-xs text-muted-foreground mt-1">Deals</p>
              </div>
              <div>
                <p className="text-2xl font-light text-foreground tabular-nums">55%</p>
                <p className="text-xs text-muted-foreground mt-1">GenAI Adoption</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-light text-foreground mb-4">
              Simple Pricing
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Choose the plan that fits your needs. Cancel anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {/* Free */}
            <div className="p-6 border border-border/30 rounded-lg">
              <h3 className="text-lg font-medium text-foreground mb-1">Free</h3>
              <p className="text-sm text-muted-foreground mb-4">Get started</p>
              <p className="text-3xl font-light text-foreground mb-6">$0<span className="text-sm text-muted-foreground">/mo</span></p>
              <ul className="space-y-3 mb-6">
                {PLAN_INFO.free.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/brief"
                className="block w-full py-2.5 text-center text-sm font-medium border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                Get Started
              </Link>
            </div>

            {/* Pro */}
            <div className="p-6 border-2 border-accent/50 rounded-lg relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-accent text-accent-foreground text-xs font-medium rounded-full">
                Most Popular
              </div>
              <h3 className="text-lg font-medium text-foreground mb-1">Pro</h3>
              <p className="text-sm text-muted-foreground mb-4">For individuals</p>
              <p className="text-3xl font-light text-foreground mb-1">${PRICING.pro.monthly}<span className="text-sm text-muted-foreground">/mo</span></p>
              <p className="text-xs text-muted-foreground mb-6">or ${PRICING.pro.annual}/year (save 32%)</p>
              <ul className="space-y-3 mb-6">
                {PLAN_INFO.pro.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className="block w-full py-2.5 text-center text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                Subscribe
              </button>
            </div>

            {/* Team */}
            <div className="p-6 border border-border/30 rounded-lg">
              <h3 className="text-lg font-medium text-foreground mb-1">Team</h3>
              <p className="text-sm text-muted-foreground mb-4">For organizations</p>
              <p className="text-3xl font-light text-foreground mb-1">${PRICING.team.monthly}<span className="text-sm text-muted-foreground">/mo</span></p>
              <p className="text-xs text-muted-foreground mb-6">or ${PRICING.team.annual}/year</p>
              <ul className="space-y-3 mb-6">
                {PLAN_INFO.team.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <svg className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className="block w-full py-2.5 text-center text-sm font-medium border border-border/50 rounded hover:bg-muted/30 transition-colors"
              >
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Methodology Teaser */}
      <section className="py-20 px-6 bg-muted/10 border-y border-border/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-light text-foreground mb-4">
            AI-Powered Analysis
          </h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            Our methodology combines automated data collection from 50+ sources with
            LLM-powered pattern detection and human editorial oversight. Every company
            analysis includes evidence counts and source attribution.
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
              <h3 className="text-base font-medium text-foreground mb-2">How often is the data updated?</h3>
              <p className="text-sm text-muted-foreground">
                We publish a comprehensive monthly brief by the 5th of each month covering the previous month's activity.
                Company data is continuously refreshed as new information becomes available.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">What funding stages do you cover?</h3>
              <p className="text-sm text-muted-foreground">
                We track Seed through Series D rounds, with a focus on AI and AI-adjacent companies.
                We include deals $1M+ to ensure signal quality.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">How are patterns detected?</h3>
              <p className="text-sm text-muted-foreground">
                Our AI system analyzes company websites, documentation, press releases, and technical content
                to identify build patterns. Each pattern assignment includes a confidence score and evidence citations.
              </p>
            </div>
            <div className="pb-6 border-b border-border/30">
              <h3 className="text-base font-medium text-foreground mb-2">Can I export the data?</h3>
              <p className="text-sm text-muted-foreground">
                Pro and Team plans include CSV export of the dealbook. PDF exports of monthly briefs are also available.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border/30">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Build Patterns</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Intelligence</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/methodology" className="hover:text-foreground transition-colors">Methodology</Link>
            <Link href="#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link href="/brief" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
          <p className="text-xs text-muted-foreground/60">
            © 2026 Build Patterns Intelligence
          </p>
        </div>
      </footer>
    </div>
  );
}

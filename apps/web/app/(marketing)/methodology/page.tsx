import Link from 'next/link';
import { NewsNav } from '@/components/news/news-nav';

export default function MethodologyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NewsNav activeRegion="global" activePeriod="daily" />

      {/* Content */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-3xl mx-auto">

          <div className="mb-8">
            <p className="label-xs text-accent-info">Editorial Standards</p>
            <h1 className="mt-2 text-3xl font-light tracking-tight text-foreground">
              Methodology
            </h1>
            <p className="body-lg mt-4 max-w-xl">
              BuildAtlas is an AI intelligence radar — designed to separate signal from noise.
              Our goal is simple: when the internet produces 1,000 &ldquo;updates,&rdquo; we want to surface the <em>few</em> that
              actually change what a builder, investor, or operator should believe or do.
            </p>
          </div>

          <div className="space-y-12">
            {/* What we mean by "signal" */}
            <section>
              <h2 className="headline-md mb-4">What we mean by &ldquo;signal&rdquo;</h2>
              <p className="body-md mb-4">
                A story is <strong className="text-foreground">signal</strong> if it meaningfully shifts at least one of these:
              </p>
              <ul className="space-y-2 body-sm mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Reality:</strong> a capability exists or changed (e.g., a real launch, benchmark, release, acquisition, outage).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Constraints:</strong> cost, latency, regulation, or safety posture materially changes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Incentives:</strong> capital flows, pricing, platform policy, or distribution shifts.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Roadmaps:</strong> credible indicators that the near future has changed.</span>
                </li>
              </ul>
              <p className="body-md">
                Everything else is <strong className="text-foreground">noise</strong>: reposts, vague claims, SEO &ldquo;explainer&rdquo; fluff, unverified rumors,
                derivative takes, and content that doesn&apos;t change decisions.
              </p>
            </section>

            {/* The AI Editor pipeline */}
            <section>
              <h2 className="headline-md mb-4">The AI Editor pipeline</h2>
              <ol className="space-y-6 body-sm">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">1</span>
                  <div>
                    <strong className="text-foreground">Ingest</strong>
                    <p className="mt-1">We collect updates from a broad set of sources — primary docs, technical blogs, press releases, major media, and relevant community channels.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">2</span>
                  <div>
                    <strong className="text-foreground">Normalize &amp; understand</strong>
                    <p className="mt-1">Each item is parsed into structured fields: entities (companies, models, people), events, claims, dates, and referenced evidence.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">3</span>
                  <div>
                    <strong className="text-foreground">Deduplicate &amp; cluster</strong>
                    <p className="mt-1">We collapse near-identical stories into a single &ldquo;event cluster&rdquo; so you don&apos;t see the same news 12 times. Within a cluster we track how the story evolves — new facts, corrections, confirmation, contradictions.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">4</span>
                  <div>
                    <strong className="text-foreground">Score for signal</strong>
                    <p className="mt-1">We assign a Signal Score using a weighted mix of:</p>
                    <ul className="mt-2 space-y-1.5">
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Novelty:</strong> is this genuinely new information vs repetition?</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Impact:</strong> does it change what matters (capability, economics, regulation, distribution)?</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Credibility:</strong> evidence strength + source reliability + cross-source agreement.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Specificity:</strong> concrete claims (&ldquo;what changed, where, when&rdquo;) beat vague narratives.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Relevance:</strong> mapped to topics and watchlists (inference, agents, GPU supply, etc.).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-accent-info">•</span>
                        <span><strong className="text-foreground">Actionability:</strong> does it imply a decision or next step?</span>
                      </li>
                    </ul>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-muted/50 text-foreground text-xs flex-shrink-0">5</span>
                  <div>
                    <strong className="text-foreground">Summarize with evidence</strong>
                    <p className="mt-1">The AI editor writes summaries that are claim-centered rather than article-centered: what happened (facts), why it matters (implications), what&apos;s uncertain (unknowns), and what to watch next (follow-up signals). Every summary is designed to be skimmable, but traceable to sources.</p>
                  </div>
                </li>
              </ol>
            </section>

            {/* Noise filters */}
            <section>
              <h2 className="headline-md mb-4">Noise filters</h2>
              <p className="body-md mb-4">
                We aggressively down-rank or exclude items with common &ldquo;noise signatures,&rdquo; such as:
              </p>
              <ul className="space-y-2 body-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Reposts without delta</strong> — no new facts compared to earlier coverage</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Second-hand reporting</strong> with no primary links</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Speculation presented as certainty</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Benchmark theater</strong> — unreproducible claims, missing settings, cherry-picked baselines</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">PR language</strong> that avoids measurable details</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Engagement bait</strong> (&ldquo;X will change everything&rdquo;) without verifiable substance</span>
                </li>
              </ul>
            </section>

            {/* Credibility & uncertainty */}
            <section>
              <h2 className="headline-md mb-4">Credibility &amp; uncertainty</h2>
              <p className="body-md mb-4">
                We treat &ldquo;truth&rdquo; as an engineering problem:
              </p>
              <ul className="space-y-2 body-sm mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Evidence-first:</strong> primary sources outrank commentary.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Agreement-aware:</strong> multiple independent confirmations raise confidence.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Contradiction-aware:</strong> conflicting reports are flagged explicitly.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Time-aware:</strong> we prefer the latest corrections over the earliest claims.</span>
                </li>
              </ul>
              <p className="body-md">
                We label confidence in plain language (e.g., High / Medium / Low) based on evidence quality and cross-source consistency.
              </p>
            </section>

            {/* Transparency */}
            <section>
              <h2 className="headline-md mb-4">Transparency: show your work</h2>
              <p className="body-md mb-4">
                Where possible, we expose:
              </p>
              <ul className="space-y-2 body-sm mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Source trail</strong> — what we read</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Why it ranked</strong> — the features that drove the score</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">What changed</strong> — edits, corrections, evolving clusters</span>
                </li>
              </ul>
              <p className="body-md">
                We also maintain a visible Changelog for major taxonomy, model, and scoring updates so the definition of &ldquo;signal&rdquo; doesn&apos;t shift silently.
              </p>
            </section>

            {/* Limitations */}
            <section>
              <h2 className="headline-md mb-4">Limitations</h2>
              <p className="body-md mb-4">
                No automated editor is perfect. Typical failure modes include:
              </p>
              <ul className="space-y-2 body-sm mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Early reports</strong> that later get corrected</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Niche community signals</strong> that are real but hard to verify quickly</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Subtle technical deltas</strong> that require domain expertise to interpret</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span><strong className="text-foreground">Coverage gaps</strong> when primary sources are inaccessible or ambiguous</span>
                </li>
              </ul>
              <p className="body-md">
                When uncertainty is high, we&apos;d rather say &ldquo;unclear&rdquo; than invent precision.
              </p>
            </section>

            {/* Our north star */}
            <section>
              <h2 className="headline-md mb-4">Our north star</h2>
              <p className="body-md mb-4">
                If you only read BuildAtlas for a few minutes a day, you should feel:
              </p>
              <ul className="space-y-2 body-sm">
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span>less overwhelmed,</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span>more confident about what actually changed,</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent-info">•</span>
                  <span>and faster at turning news into decisions.</span>
                </li>
              </ul>
              <p className="body-md mt-4">
                That&apos;s the bar.
              </p>
            </section>
          </div>

          <div className="mt-16 p-6 rounded-2xl border border-border/40 bg-card/60 text-center">
            <p className="body-md mb-4">
              Ready to see it in action?
            </p>
            <Link
              href="/dealbook"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Explore Dossiers
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

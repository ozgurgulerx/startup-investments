import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Globe,
  DollarSign,
  Building2,
  Cpu,
  Shield,
  Target,
  Lightbulb,
  AlertTriangle,
  ExternalLink,
  Users,
  Layers,
  FileText,
  BookOpen,
  Code,
  Newspaper,
  FileCode,
  Quote,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import {
  getStartup,
  getStartupMetadata,
  getStartupBrief,
  getAvailablePeriods,
} from '@/lib/data';
import { formatCurrency, cn } from '@/lib/utils';

// Enhanced markdown to HTML for brief display with improved styling
function markdownToHtml(markdown: string): string {
  let html = markdown
    // Headers with clear hierarchy
    .replace(/^# (.*$)/gm, '<h1 class="brief-h1">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 class="brief-h2">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 class="brief-h3">$1</h3>')
    .replace(/^#### (.*$)/gm, '<h4 class="brief-h4">$1</h4>')
    // Blockquotes
    .replace(/^> (.*)$/gm, '<blockquote class="brief-blockquote">$1</blockquote>')
    // Code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre class="brief-codeblock"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="brief-inline-code">$1</code>')
    // Bold and italic
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="brief-bold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em class="brief-italic">$1</em>')
    // Tables
    .replace(/^\|(.+)\|$/gm, (match, content) => {
      const cells = content.split('|').map((c: string) => c.trim());
      if (cells.every((cell: string) => /^[-:]+$/.test(cell))) {
        return '<!-- separator -->';
      }
      return `<tr class="brief-table-row">${cells.map((c: string) => `<td class="brief-table-cell">${c}</td>`).join('')}</tr>`;
    })
    // Lists
    .replace(/^- (.*)$/gm, '<li class="brief-list-item">$1</li>')
    .replace(/^\* (.*)$/gm, '<li class="brief-list-item">$1</li>')
    .replace(/^\d+\. (.*)$/gm, '<li class="brief-list-item-num">$1</li>')
    // Dividers
    .replace(/^---$/gm, '<hr class="brief-divider">')
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="brief-paragraph">');

  // Clean up consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote class="brief-blockquote">/g, '<br>');

  // Wrap lists
  html = html.replace(/(<li class="brief-list-item">.*<\/li>\n?)+/g, (match) => {
    return `<ul class="brief-list">${match}</ul>`;
  });
  html = html.replace(/(<li class="brief-list-item-num">.*<\/li>\n?)+/g, (match) => {
    return `<ol class="brief-list-numbered">${match}</ol>`;
  });

  // Wrap tables
  html = html.replace(/(<tr class="brief-table-row">.*<\/tr>\n?)+/g, (match) => {
    const cleanMatch = match.replace(/<!-- separator -->\n?/g, '');
    return `<table class="brief-table"><tbody>${cleanMatch}</tbody></table>`;
  });

  return html;
}

// Get source type icon and label
function getSourceTypeInfo(url: string): { icon: typeof Globe; label: string; priority: number } {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('/docs') || urlLower.includes('documentation') || urlLower.includes('readme')) {
    return { icon: BookOpen, label: 'Docs', priority: 1 };
  }
  if (urlLower.includes('github.com')) {
    return { icon: Code, label: 'GitHub', priority: 2 };
  }
  if (urlLower.includes('/blog') || urlLower.includes('medium.com') || urlLower.includes('substack')) {
    return { icon: FileText, label: 'Blog', priority: 3 };
  }
  if (urlLower.includes('techcrunch') || urlLower.includes('news') || urlLower.includes('venturebeat') || urlLower.includes('forbes')) {
    return { icon: Newspaper, label: 'News', priority: 4 };
  }
  return { icon: Globe, label: 'Website', priority: 5 };
}

const DEFAULT_PERIOD = '2026-01';

interface PageProps {
  params: { slug: string };
}

async function StartupDetailContent({ slug }: { slug: string }) {
  const [startup, metadata, brief, periods] = await Promise.all([
    getStartup(DEFAULT_PERIOD, slug),
    getStartupMetadata(DEFAULT_PERIOD, slug),
    getStartupBrief(DEFAULT_PERIOD, slug),
    getAvailablePeriods(),
  ]);

  if (!startup) {
    notFound();
  }

  // Get top 5 crawl URLs (prioritize docs, blog, then website)
  const topUrls: string[] = [];
  if (metadata) {
    const docs = metadata.sources_by_type?.docs || [];
    const blog = metadata.sources_by_type?.blog || [];
    const website = metadata.sources_by_type?.website || [];
    topUrls.push(...docs.slice(0, 2), ...blog.slice(0, 2), ...website.slice(0, 1));
  }

  return (
    <DashboardLayout
      initialPeriod={DEFAULT_PERIOD}
      availablePeriods={periods.map((p) => p.period)}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Back Button */}
        <Link
          href="/startups"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Startups
        </Link>

        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-purple-500/10 to-blue-500/10 rounded-2xl blur-3xl -z-10" />
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 p-6 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                {startup.company_name}
              </h1>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {startup.website && (
                  <a
                    href={startup.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline bg-primary/10 px-2.5 py-1 rounded-full transition-colors hover:bg-primary/20"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {startup.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                )}
                <Badge variant="outline" className="rounded-full">
                  {(startup.funding_stage || 'Unknown').replace(/_/g, ' ')}
                </Badge>
                <Badge
                  variant={startup.market_type === 'horizontal' ? 'default' : 'secondary'}
                  className="rounded-full"
                >
                  {startup.market_type === 'horizontal' ? 'Horizontal' : startup.vertical?.replace(/_/g, ' ')}
                </Badge>
                {startup.uses_genai && (
                  <Badge variant="success" className="rounded-full">
                    GenAI {startup.genai_intensity}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right md:text-right">
              <div className="inline-block p-4 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
                <p className="text-3xl font-bold text-primary tabular-nums">
                  {formatCurrency(startup.funding_amount || 0, true)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Funding Raised</p>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {startup.description && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground">{startup.description}</p>
            </CardContent>
          </Card>
        )}

        {/* Analysis Brief */}
        {brief && (
          <Card className="border-primary/20">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCode className="h-4 w-4 text-primary" />
                Full Analysis Brief
                <Badge variant="secondary" className="ml-2 text-xs">AI-Generated</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <details className="group">
                <summary className="cursor-pointer text-sm text-primary hover:underline flex items-center gap-2">
                  <span className="group-open:hidden">Show full analysis</span>
                  <span className="hidden group-open:inline">Hide full analysis</span>
                </summary>
                <div className="mt-4 max-h-[600px] overflow-y-auto pr-2">
                  <article
                    className="prose prose-sm prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(brief) }}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        )}

        {/* Key Metrics Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4 hover:border-primary/30 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 group-hover:from-primary/30 group-hover:to-primary/10 transition-colors">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Target Market</p>
                <p className="font-semibold">{startup.target_market?.toUpperCase() || 'Unknown'}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 hover:border-blue-500/30 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 group-hover:from-blue-500/30 group-hover:to-blue-500/10 transition-colors">
                <Cpu className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Technical Depth</p>
                <p className="font-semibold capitalize">{startup.technical_depth || 'Unknown'}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 hover:border-green-500/30 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-green-500/20 to-green-500/5 group-hover:from-green-500/30 group-hover:to-green-500/10 transition-colors">
                <Shield className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Competitive Moat</p>
                <p className="font-semibold capitalize">{startup.competitive_analysis?.competitive_moat || 'Unknown'}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 hover:border-yellow-500/30 transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-500/5 group-hover:from-yellow-500/30 group-hover:to-yellow-500/10 transition-colors">
                <Cpu className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">GenAI Intensity</p>
                <p className="font-semibold capitalize">{startup.genai_intensity || 'None'}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Two Column Layout */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Build Patterns */}
          <Card className="border-purple-500/20 bg-gradient-to-br from-card to-purple-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-purple-400" />
                Build Patterns
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {startup.build_patterns?.length ? (
                startup.build_patterns.map((pattern, index) => (
                  <div key={index} className="p-3 rounded-lg bg-background/50 border border-border hover:border-purple-500/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{pattern.name}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full transition-all"
                            style={{ width: `${pattern.confidence * 100}%` }}
                          />
                        </div>
                        <Badge variant="outline" className="text-[10px] tabular-nums">
                          {Math.round(pattern.confidence * 100)}%
                        </Badge>
                      </div>
                    </div>
                    {pattern.description && (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        {pattern.description}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No patterns detected</p>
              )}
            </CardContent>
          </Card>

          {/* Tech Stack */}
          <Card className="border-blue-500/20 bg-gradient-to-br from-card to-blue-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="h-4 w-4 text-blue-400" />
                Tech Stack & Models
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* LLM Models Used */}
              {((startup.models_mentioned?.length ?? 0) > 0 || (startup.tech_stack?.llm_models?.length ?? 0) > 0) && (
                <div className="p-3 rounded-lg bg-background/50 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">Models Mentioned</p>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Quote className="h-2.5 w-2.5" />
                      Extracted from sources
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set([...(startup.models_mentioned || []), ...(startup.tech_stack?.llm_models || [])])].map((model, i) => (
                      <Badge key={i} variant="secondary" className="text-xs bg-blue-500/10 text-blue-300 border-blue-500/20">
                        {model}
                      </Badge>
                    ))}
                  </div>
                  {/* Model citation from evidence quotes */}
                  {startup.evidence_quotes?.some(q =>
                    [...(startup.models_mentioned || []), ...(startup.tech_stack?.llm_models || [])].some(
                      m => q.toLowerCase().includes(m.toLowerCase())
                    )
                  ) && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Quote className="h-2.5 w-2.5" />
                        Source evidence:
                      </p>
                      <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">
                        "{startup.evidence_quotes?.find(q =>
                          [...(startup.models_mentioned || []), ...(startup.tech_stack?.llm_models || [])].some(
                            m => q.toLowerCase().includes(m.toLowerCase())
                          )
                        )}"
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* LLM Providers */}
              {(startup.tech_stack?.llm_providers?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">LLM Providers</p>
                  <div className="flex flex-wrap gap-1">
                    {startup.tech_stack?.llm_providers?.map((provider, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {provider}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Frameworks */}
              {(startup.tech_stack?.frameworks?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Frameworks</p>
                  <div className="flex flex-wrap gap-1">
                    {startup.tech_stack?.frameworks?.map((fw, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {fw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Approach */}
              {startup.tech_stack?.approach && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Approach</p>
                  <p className="text-sm font-medium capitalize">{startup.tech_stack.approach.replace(/_/g, ' ')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Unique Findings */}
        {(startup.unique_findings?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="h-4 w-4" />
                Unique Findings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {startup.unique_findings?.map((finding, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary mt-1">•</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Story Angles */}
        {(startup.story_angles?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Story Angles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {startup.story_angles?.map((angle, i) => (
                <div key={i} className="p-4 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {angle.angle_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Uniqueness: {angle.uniqueness_score}/10
                    </span>
                  </div>
                  <h4 className="font-medium text-sm">{angle.headline}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{angle.summary}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Competitive Analysis */}
        {(startup.competitive_analysis?.competitors?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Competitive Landscape
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Secret Sauce */}
              {startup.competitive_analysis?.secret_sauce && (
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-xs text-primary font-medium mb-2">Secret Sauce</p>
                  <p className="text-sm">
                    {typeof startup.competitive_analysis.secret_sauce === 'string'
                      ? startup.competitive_analysis.secret_sauce
                      : startup.competitive_analysis.secret_sauce.core_advantage}
                  </p>
                  {typeof startup.competitive_analysis.secret_sauce !== 'string' &&
                    startup.competitive_analysis.secret_sauce.defensibility && (
                    <p className="text-xs text-muted-foreground mt-2">
                      <strong>Defensibility:</strong> {startup.competitive_analysis.secret_sauce.defensibility}
                    </p>
                  )}
                </div>
              )}

              {/* Competitors */}
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Key Competitors</p>
                {startup.competitive_analysis?.competitors?.slice(0, 3).map((comp, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50">
                    <p className="font-medium text-sm">{comp.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      <strong>Similarity:</strong> {comp.similarity}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      <strong>Differentiation:</strong> {comp.how_different}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Anti-Patterns */}
        {(startup.anti_patterns?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-warning">
                <AlertTriangle className="h-4 w-4" />
                Warning Signs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {startup.anti_patterns?.map((pattern, i) => (
                <div key={i} className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm capitalize">
                      {pattern.pattern_type.replace(/_/g, ' ')}
                    </span>
                    <Badge
                      variant={pattern.severity === 'high' ? 'destructive' : pattern.severity === 'medium' ? 'warning' : 'outline'}
                      className="text-xs"
                    >
                      {pattern.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{pattern.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* High-Signal Sources */}
        {topUrls.length > 0 && (
          <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ExternalLink className="h-4 w-4 text-primary" />
                High-Signal Sources
                <Badge variant="secondary" className="ml-auto text-xs">
                  {metadata?.pages_crawled || 0} pages analyzed
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topUrls.slice(0, 5).map((url, i) => {
                  const sourceInfo = getSourceTypeInfo(url);
                  const SourceIcon = sourceInfo.icon;
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg bg-background/50 hover:bg-background border border-transparent hover:border-primary/30 transition-all text-sm group"
                    >
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <SourceIcon className="h-4 w-4 text-primary" />
                        <Badge variant="outline" className="text-xs font-medium">
                          {sourceInfo.label}
                        </Badge>
                      </div>
                      <span className="truncate text-muted-foreground group-hover:text-foreground transition-colors">
                        {url.replace(/^https?:\/\//, '').slice(0, 60)}
                        {url.length > 60 ? '...' : ''}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </a>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Evidence Quotes */}
        {(startup.evidence_quotes?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evidence Quotes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {startup.evidence_quotes?.slice(0, 10).map((quote, i) => (
                  <blockquote
                    key={i}
                    className="pl-4 border-l-2 border-primary/50 text-sm text-muted-foreground italic"
                  >
                    "{quote}"
                  </blockquote>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function StartupDetailLoading() {
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-12 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    </DashboardLayout>
  );
}

export default function StartupDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<StartupDetailLoading />}>
      <StartupDetailContent slug={params.slug} />
    </Suspense>
  );
}

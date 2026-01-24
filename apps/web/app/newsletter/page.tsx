import { Suspense } from 'react';
import { DashboardLayout } from '@/components/layout';
import { Card } from '@/components/ui';
import { getNewsletterMarkdown, getAvailablePeriods } from '@/lib/data';
import { formatPeriod } from '@/lib/utils';

const DEFAULT_PERIOD = '2026-01';

function convertMarkdownToHtml(markdown: string): string {
  let html = markdown
    // Headers with proper styling
    .replace(/^# (.*$)/gm, '<h1 class="newsletter-h1">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 class="newsletter-h2">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 class="newsletter-h3">$1</h3>')
    .replace(/^#### (.*$)/gm, '<h4 class="newsletter-h4">$1</h4>')
    // Blockquotes with styling
    .replace(/^> (.*)$/gm, '<blockquote class="newsletter-blockquote">$1</blockquote>')
    // Code blocks (before inline code)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="newsletter-codeblock"><code>$2</code></pre>')
    // Inline code with backticks
    .replace(/`([^`]+)`/g, '<code class="newsletter-inline-code">$1</code>')
    // Bold text
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="newsletter-bold">$1</strong>')
    // Italic text
    .replace(/\*([^*]+)\*/g, '<em class="newsletter-italic">$1</em>')
    // Tables - header row detection
    .replace(/^\|(.+)\|$/gm, (match, content) => {
      const cells = content.split('|').map((c: string) => c.trim());
      // Check if this is a separator row (contains only dashes and colons)
      if (cells.every((cell: string) => /^[-:]+$/.test(cell))) {
        return '<!-- table-separator -->';
      }
      return `<tr class="newsletter-table-row">${cells.map((c: string) => `<td class="newsletter-table-cell">${c}</td>`).join('')}</tr>`;
    })
    // Unordered lists
    .replace(/^- (.*)$/gm, '<li class="newsletter-list-item">$1</li>')
    .replace(/^\* (.*)$/gm, '<li class="newsletter-list-item">$1</li>')
    // Numbered lists
    .replace(/^\d+\. (.*)$/gm, '<li class="newsletter-list-item-numbered">$1</li>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="newsletter-divider">')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p class="newsletter-paragraph">');

  // Clean up consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote class="newsletter-blockquote">/g, '<br>');

  // Wrap consecutive list items in ul/ol
  html = html.replace(/(<li class="newsletter-list-item">.*<\/li>\n?)+/g, (match) => {
    return `<ul class="newsletter-list">${match}</ul>`;
  });
  html = html.replace(/(<li class="newsletter-list-item-numbered">.*<\/li>\n?)+/g, (match) => {
    return `<ol class="newsletter-list-numbered">${match}</ol>`;
  });

  // Wrap consecutive table rows in table
  html = html.replace(/(<tr class="newsletter-table-row">.*<\/tr>\n?)+/g, (match) => {
    // Remove separator comments
    const cleanMatch = match.replace(/<!-- table-separator -->\n?/g, '');
    return `<table class="newsletter-table"><tbody>${cleanMatch}</tbody></table>`;
  });

  return html;
}

async function NewsletterContent() {
  const [markdown, periods] = await Promise.all([
    getNewsletterMarkdown(DEFAULT_PERIOD),
    getAvailablePeriods(),
  ]);

  if (!markdown) {
    return (
      <DashboardLayout
        initialPeriod={DEFAULT_PERIOD}
        availablePeriods={periods.map((p) => p.period)}
      >
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">No newsletter available for this period.</p>
        </div>
      </DashboardLayout>
    );
  }

  const htmlContent = convertMarkdownToHtml(markdown);

  return (
    <DashboardLayout
      initialPeriod={DEFAULT_PERIOD}
      availablePeriods={periods.map((p) => p.period)}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="border-b border-border pb-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
            Newsletter
          </h1>
          <p className="text-muted-foreground mt-1">
            Build Patterns Weekly · {formatPeriod(DEFAULT_PERIOD)}
          </p>
        </div>

        {/* Newsletter Content */}
        <Card className="newsletter-card p-8 md:p-12">
          <article
            className="newsletter-content"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

function NewsletterLoading() {
  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-[600px] animate-pulse rounded-xl bg-muted" />
      </div>
    </DashboardLayout>
  );
}

export default function NewsletterPage() {
  return (
    <Suspense fallback={<NewsletterLoading />}>
      <NewsletterContent />
    </Suspense>
  );
}

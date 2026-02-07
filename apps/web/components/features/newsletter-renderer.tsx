'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface NewsletterRendererProps {
  content: string;
  className?: string;
}

// Known patterns that should link to dealbook
const KNOWN_PATTERNS = [
  'Agentic Architectures',
  'Vertical Data Moats',
  'RAG (Retrieval-Augmented Generation)',
  'Micro-model Meshes',
  'Continuous-learning Flywheels',
  'Guardrail-as-LLM',
  'API-first AI',
  'LLMOps',
  'Edge AI',
  'Multimodal',
];

export function NewsletterRenderer({ content, className }: NewsletterRendererProps) {
  return (
    <div className={cn('newsletter-prose', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headers
          h1: ({ children }) => (
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mt-0 mb-6 leading-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl md:text-2xl font-semibold text-foreground mt-12 mb-4 pb-3 border-b border-border/30">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold text-foreground mt-8 mb-3">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-medium text-foreground/90 mt-6 mb-2">
              {children}
            </h4>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-[15px] text-muted-foreground leading-relaxed my-4">
              {children}
            </p>
          ),

          // Strong/Bold
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),

          // Emphasis/Italic
          em: ({ children }) => (
            <em className="text-muted-foreground/80 not-italic">{children}</em>
          ),

          // Links - handle internal dealbook links and external links
          a: ({ href, children }) => {
            // Check if it's an internal dealbook link
            if (href?.startsWith('/dealbook')) {
              return (
                <Link
                  href={href}
                  className="text-accent-info hover:text-accent-info/80 underline underline-offset-2 transition-colors"
                >
                  {children}
                </Link>
              );
            }
            // External links open in new tab
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
              >
                {children}
              </a>
            );
          },

          // Lists
          ul: ({ children }) => (
            <ul className="my-4 ml-6 space-y-2 list-disc marker:text-primary/50">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-4 ml-6 space-y-2 list-decimal marker:text-primary/50">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-[15px] text-muted-foreground leading-relaxed pl-1">
              {children}
            </li>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="my-6 pl-4 border-l-4 border-primary/40 bg-primary/5 rounded-r-lg py-3 pr-4">
              <div className="text-muted-foreground italic">{children}</div>
            </blockquote>
          ),

          // Code blocks
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-muted text-primary text-sm font-mono">
                  {children}
                </code>
              );
            }
            // For block code (inside pre), preserve whitespace for ASCII art
            return (
              <code className="block text-sm font-mono text-foreground/80 whitespace-pre leading-snug">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-6 p-4 rounded-lg bg-muted/50 border border-border/30 overflow-x-auto text-sm whitespace-pre font-mono leading-snug">
              {children}
            </pre>
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-lg border border-border/30">
              <table className="w-full text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/40 border-b border-border/30">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/20">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-muted/20 transition-colors">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => {
            // Check if cell contains a pattern name that should link to dealbook
            const childText = typeof children === 'string' ? children :
              (Array.isArray(children) && typeof children[0] === 'string') ? children[0] : null;

            if (childText && KNOWN_PATTERNS.some(p => childText.includes(p))) {
              const pattern = KNOWN_PATTERNS.find(p => childText.includes(p));
              if (pattern) {
                return (
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    <Link
                      href={`/dealbook?pattern=${encodeURIComponent(pattern)}`}
                      className="text-accent-info hover:text-accent-info/80 underline underline-offset-2 transition-colors"
                    >
                      {children}
                    </Link>
                  </td>
                );
              }
            }

            return (
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {children}
              </td>
            );
          },

          // Horizontal Rule
          hr: () => (
            <div className="my-10 relative">
              <hr className="border-t border-border/30" />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4 bg-card">
                <div className="w-8 h-1 bg-gradient-to-r from-primary/40 to-sky-500/40 rounded-full" />
              </div>
            </div>
          ),

          // Images
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || ''}
              className="my-6 rounded-lg max-w-full h-auto"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

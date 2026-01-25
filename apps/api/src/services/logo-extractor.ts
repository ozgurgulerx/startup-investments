/**
 * Logo extraction service for startups.
 *
 * Extracts company logos from:
 * - Open Graph images (og:image)
 * - Twitter card images
 * - Logo tags in HTML
 * - Apple touch icons
 * - Favicon (if SVG or large enough)
 * - Clearbit Logo API (fallback)
 */

import * as cheerio from 'cheerio';
import { db } from '../db';
import { startups } from '../db/schema';
import { eq, isNull, sql } from 'drizzle-orm';

interface LogoResult {
  name: string;
  slug: string;
  status: 'success' | 'failed' | 'skipped';
  logoUrl?: string;
  reason?: string;
}

interface ExtractionResults {
  success: LogoResult[];
  failed: LogoResult[];
  skipped: LogoResult[];
  total: number;
}

export class LogoExtractor {
  private userAgent = 'Mozilla/5.0 (compatible; StartupAnalyzer/1.0)';
  private timeout = 15000; // 15 seconds

  /**
   * Extract logos for all startups without logos
   */
  async extractAll(options?: { force?: boolean; limit?: number }): Promise<ExtractionResults> {
    const results: ExtractionResults = {
      success: [],
      failed: [],
      skipped: [],
      total: 0,
    };

    // Get startups that need logos
    let query = db.select({
      id: startups.id,
      name: startups.name,
      slug: startups.slug,
      website: startups.website,
      hasLogo: sql<boolean>`logo_data IS NOT NULL`.as('has_logo'),
    }).from(startups);

    if (!options?.force) {
      query = query.where(isNull(startups.logoData)) as typeof query;
    }

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    const startupsToProcess = await query;
    results.total = startupsToProcess.length;

    console.log(`Processing ${results.total} startups for logo extraction...`);

    for (const startup of startupsToProcess) {
      const slug = startup.slug || this.toSlug(startup.name);

      // Skip if already has logo (unless force)
      if (startup.hasLogo && !options?.force) {
        results.skipped.push({
          name: startup.name,
          slug,
          status: 'skipped',
          reason: 'Already has logo',
        });
        continue;
      }

      // Skip if no website
      if (!startup.website) {
        results.skipped.push({
          name: startup.name,
          slug,
          status: 'skipped',
          reason: 'No website',
        });
        continue;
      }

      console.log(`  Processing: ${startup.name}...`);

      try {
        const logoResult = await this.extractAndSave(startup.id, startup.name, startup.website, slug);

        if (logoResult) {
          results.success.push({
            name: startup.name,
            slug,
            status: 'success',
            logoUrl: `/api/startups/${slug}/logo`,
          });
          console.log(`    [OK] Logo saved`);
        } else {
          results.failed.push({
            name: startup.name,
            slug,
            status: 'failed',
            reason: 'No logo found',
          });
          console.log(`    [--] No logo found`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.failed.push({
          name: startup.name,
          slug,
          status: 'failed',
          reason: errorMessage,
        });
        console.log(`    [ERR] ${errorMessage}`);
      }

      // Small delay to avoid rate limiting
      await this.delay(500);
    }

    console.log(`\nResults:`);
    console.log(`  Success: ${results.success.length}`);
    console.log(`  Failed: ${results.failed.length}`);
    console.log(`  Skipped: ${results.skipped.length}`);

    return results;
  }

  /**
   * Extract and save logo for a single startup
   */
  async extractAndSave(
    startupId: string,
    companyName: string,
    website: string,
    slug: string
  ): Promise<boolean> {
    // Ensure website has protocol
    const url = website.startsWith('http') ? website : `https://${website}`;

    // Try to find logo URL
    const logoUrl = await this.findLogoUrl(url);

    if (logoUrl) {
      const saved = await this.downloadAndSave(startupId, logoUrl, slug);
      if (saved) return true;
    }

    // Fallback: Try Clearbit Logo API
    const clearbitSaved = await this.tryClearbit(startupId, website, slug);
    if (clearbitSaved) return true;

    return false;
  }

  /**
   * Find logo URL from website HTML
   */
  private async findLogoUrl(websiteUrl: string): Promise<string | null> {
    try {
      const response = await fetch(websiteUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);

      // Strategy 1: Open Graph image (often high quality)
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) {
        const url = this.resolveUrl(ogImage, websiteUrl);
        if (await this.isValidImage(url)) return url;
      }

      // Strategy 2: Twitter card image
      const twitterImage = $('meta[name="twitter:image"]').attr('content');
      if (twitterImage) {
        const url = this.resolveUrl(twitterImage, websiteUrl);
        if (await this.isValidImage(url)) return url;
      }

      // Strategy 3: Look for logo in common patterns
      const logoSelectors = [
        'img[class*="logo"]',
        'img[id*="logo"]',
        'img[src*="logo"]',
        'img[alt*="logo"]',
        'header img',
        'nav img',
        '.navbar img',
        '.header img',
        'a[href="/"] img',
      ];

      for (const selector of logoSelectors) {
        const img = $(selector).first();
        const src = img.attr('src');
        if (src) {
          const url = this.resolveUrl(src, websiteUrl);
          if (await this.isValidImage(url)) return url;
        }
      }

      // Strategy 4: Apple touch icon (usually high quality)
      const appleIcon = $('link[rel="apple-touch-icon"]').attr('href');
      if (appleIcon) {
        const url = this.resolveUrl(appleIcon, websiteUrl);
        if (await this.isValidImage(url)) return url;
      }

      // Strategy 5: Favicon (last resort, only if SVG or large)
      const favicon = $('link[rel*="icon"]').attr('href');
      if (favicon) {
        const url = this.resolveUrl(favicon, websiteUrl);
        if (url.endsWith('.svg') || await this.isValidImage(url, 1000)) {
          return url;
        }
      }

      return null;
    } catch (error) {
      console.log(`    Warning: Could not fetch ${websiteUrl}: ${error}`);
      return null;
    }
  }

  /**
   * Try Clearbit Logo API as fallback
   */
  private async tryClearbit(startupId: string, website: string, slug: string): Promise<boolean> {
    try {
      // Extract domain
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      const domain = url.hostname.replace('www.', '');

      const clearbitUrl = `https://logo.clearbit.com/${domain}`;

      const response = await fetch(clearbitUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return false;

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 1000) return false;

      const contentType = response.headers.get('content-type') || 'image/png';

      // Save to database
      await db.update(startups)
        .set({
          logoData: Buffer.from(buffer),
          logoContentType: this.normalizeContentType(contentType),
          logoUpdatedAt: new Date(),
          slug: slug,
        })
        .where(eq(startups.id, startupId));

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Download image and save to database
   */
  private async downloadAndSave(startupId: string, imageUrl: string, slug: string): Promise<boolean> {
    try {
      const response = await fetch(imageUrl, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) return false;

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 500) return false;

      const contentType = response.headers.get('content-type') || 'image/png';

      // Save to database
      await db.update(startups)
        .set({
          logoData: Buffer.from(buffer),
          logoContentType: this.normalizeContentType(contentType),
          logoUpdatedAt: new Date(),
          slug: slug,
        })
        .where(eq(startups.id, startupId));

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if URL points to a valid image
   */
  private async isValidImage(url: string, minSize: number = 500): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return false;

      const contentType = response.headers.get('content-type') || '';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      // Check content type
      if (!contentType.includes('image') && !contentType.includes('svg')) {
        return false;
      }

      // Check size (if provided)
      if (contentLength > 0 && contentLength < minSize) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(url: string, base: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('//')) {
      return `https:${url}`;
    }
    return new URL(url, base).href;
  }

  /**
   * Normalize content type
   */
  private normalizeContentType(contentType: string): string {
    const ct = contentType.toLowerCase();
    if (ct.includes('svg')) return 'image/svg+xml';
    if (ct.includes('png')) return 'image/png';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg';
    if (ct.includes('webp')) return 'image/webp';
    if (ct.includes('gif')) return 'image/gif';
    return 'image/png';
  }

  /**
   * Convert company name to slug
   */
  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const logoExtractor = new LogoExtractor();

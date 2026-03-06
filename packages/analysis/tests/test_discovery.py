from __future__ import annotations

from src.crawl_runtime.discovery import (
    _extract_sitemap_from_robots,
    _parse_feed_entry_urls,
    _parse_sitemap_xml,
    _parse_sitemap_xml_nodes,
)


def test_extract_sitemap_lines_from_robots():
    robots = """
    User-agent: *
    Disallow: /admin
    Sitemap: https://acme.com/sitemap.xml
    Sitemap: https://acme.com/sitemap-blog.xml
    """
    urls = _extract_sitemap_from_robots(robots)
    assert urls == ["https://acme.com/sitemap.xml", "https://acme.com/sitemap-blog.xml"]


def test_parse_sitemap_xml_loc_entries():
    xml = """
    <urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">
      <url><loc>https://acme.com/</loc></url>
      <url><loc>https://acme.com/pricing</loc></url>
    </urlset>
    """
    urls = _parse_sitemap_xml(xml)
    assert "https://acme.com/" in urls
    assert "https://acme.com/pricing" in urls


def test_parse_sitemap_index_entries():
    xml = """
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://acme.com/sitemap-pages.xml</loc></sitemap>
      <sitemap><loc>https://acme.com/sitemap-blog.xml</loc></sitemap>
    </sitemapindex>
    """
    urls, sitemaps = _parse_sitemap_xml_nodes(xml)
    assert urls == []
    assert "https://acme.com/sitemap-pages.xml" in sitemaps
    assert "https://acme.com/sitemap-blog.xml" in sitemaps


def test_parse_feed_entries_rss_and_atom():
    rss = """
    <rss version="2.0">
      <channel>
        <item><link>https://acme.com/blog/post-1</link></item>
        <item><link>https://acme.com/blog/post-2</link></item>
      </channel>
    </rss>
    """
    atom = """
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry><link href="https://acme.com/changelog/entry-1"/></entry>
    </feed>
    """
    rss_urls = _parse_feed_entry_urls(rss)
    atom_urls = _parse_feed_entry_urls(atom)
    assert "https://acme.com/blog/post-1" in rss_urls
    assert "https://acme.com/blog/post-2" in rss_urls
    assert "https://acme.com/changelog/entry-1" in atom_urls

from __future__ import annotations

from src.crawl_runtime.discovery import _extract_sitemap_from_robots, _parse_sitemap_xml


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

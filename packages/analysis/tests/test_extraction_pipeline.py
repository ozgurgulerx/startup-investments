"""Tests for content extraction pipeline with Trafilatura fallback."""

from src.crawl_runtime.extraction import extract_main_content, extract_title


def test_extract_title_prefers_title_tag():
    html = "<html><head><title>Acme Docs</title></head><body><h1>Ignored</h1></body></html>"
    assert extract_title(html) == "Acme Docs"


def test_extract_main_content_returns_text_and_markdown():
    html = """
    <html>
      <body>
        <header>Navigation</header>
        <main>
          <h1>Product Update</h1>
          <p>We launched a new API today.</p>
        </main>
      </body>
    </html>
    """
    text, markdown = extract_main_content(html)
    assert "new API" in text
    assert markdown is not None

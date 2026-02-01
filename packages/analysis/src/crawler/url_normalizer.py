"""URL Normalization for Crawler.

Provides URL canonicalization to:
- Deduplicate URLs that point to the same content
- Remove tracking parameters
- Normalize protocol, www prefix, trailing slashes
- Handle common URL variations
"""

import re
from urllib.parse import urlparse, urlunparse, parse_qs
from typing import Optional


# Common tracking parameters to remove
TRACKING_PARAMS = {
    # Google Analytics / Ads
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
    # Facebook
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
    # Microsoft / Bing
    'msclkid',
    # Twitter
    'twclid',
    # LinkedIn
    'li_fat_id',
    # General
    'ref', 'source', 'referrer', 'campaign', 'affiliate',
    # Email marketing
    'mc_cid', 'mc_eid', 'mkt_tok',
    # Analytics
    '_ga', '_gl', '_hsenc', '_hsmi', 'hsCtaTracking',
    # Session / tracking
    'sessionid', 'sid', 'token', 'trk', 'tracking',
    # Misc
    'share', 'shared', 'via', 'from', 's', 'cmp',
}

# Parameters that affect content (should be kept)
CONTENT_PARAMS = {
    'page', 'p', 'id', 'slug', 'q', 'query', 'search',
    'category', 'tag', 'sort', 'order', 'filter',
    'lang', 'language', 'locale', 'hl',
    'version', 'v', 'tab', 'section',
}


def canonicalize_url(url: str, keep_fragment: bool = False) -> str:
    """Normalize URL to canonical form.

    Transformations applied:
    1. Lowercase scheme and host
    2. Force HTTPS (unless localhost)
    3. Remove www. prefix
    4. Remove default ports (:443, :80)
    5. Normalize path (remove trailing slash except for root)
    6. Remove tracking parameters
    7. Sort remaining query parameters
    8. Remove fragment (optional)

    Args:
        url: The URL to canonicalize
        keep_fragment: If True, preserve URL fragment (#...)

    Returns:
        Canonicalized URL string

    Examples:
        >>> canonicalize_url("https://www.example.com/page/?utm_source=google&ref=123")
        'https://example.com/page'

        >>> canonicalize_url("HTTP://EXAMPLE.COM:80/Page/")
        'https://example.com/page'

        >>> canonicalize_url("https://example.com/search?q=test&utm_campaign=abc")
        'https://example.com/search?q=test'
    """
    if not url:
        return ""

    url = url.strip()

    # Handle URLs without scheme
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    try:
        parsed = urlparse(url)
    except Exception:
        return url  # Return original if parsing fails

    # Normalize scheme to lowercase, prefer https
    scheme = parsed.scheme.lower()
    host = parsed.netloc.lower()

    # Don't upgrade localhost to https
    is_localhost = host.startswith('localhost') or host.startswith('127.0.0.1')
    if not is_localhost:
        scheme = 'https'

    # Remove www. prefix
    if host.startswith('www.'):
        host = host[4:]

    # Remove default ports
    host = re.sub(r':443$', '', host)  # HTTPS default
    host = re.sub(r':80$', '', host)   # HTTP default

    # Normalize path
    path = parsed.path

    # Decode percent-encoded characters that don't need encoding
    # But be careful to preserve necessary encoding
    try:
        # Normalize multiple slashes to single
        path = re.sub(r'/+', '/', path)
    except Exception:
        pass

    # Remove trailing slash except for root
    if path != '/' and path.endswith('/'):
        path = path.rstrip('/')

    # Ensure path starts with /
    if not path:
        path = '/'

    # Lowercase path (controversial - some servers are case-sensitive)
    # We do this because most modern servers are case-insensitive
    # and it helps with deduplication
    path = path.lower()

    # Handle query parameters
    query = ''
    if parsed.query:
        params = parse_qs(parsed.query, keep_blank_values=False)

        # Filter out tracking parameters
        filtered_params = {}
        for key, values in params.items():
            key_lower = key.lower()
            # Keep the parameter if it's not a tracking param
            if key_lower not in TRACKING_PARAMS:
                filtered_params[key] = values

        # Sort parameters for consistent ordering
        if filtered_params:
            # urlencode with sorted keys, use first value for each param
            sorted_params = sorted(filtered_params.items())
            query_parts = []
            for key, values in sorted_params:
                for value in values:
                    query_parts.append(f"{key}={value}")
            query = '&'.join(query_parts)

    # Handle fragment
    fragment = parsed.fragment if keep_fragment else ''

    # Reconstruct URL
    canonical = urlunparse((scheme, host, path, '', query, fragment))

    return canonical


def extract_domain(url: str) -> str:
    """Extract the domain from a URL.

    Args:
        url: The URL to extract domain from

    Returns:
        Domain string (e.g., 'example.com')
    """
    if not url:
        return ""

    try:
        parsed = urlparse(url if '://' in url else f'https://{url}')
        host = parsed.netloc.lower()

        # Remove www. prefix
        if host.startswith('www.'):
            host = host[4:]

        # Remove port
        host = re.sub(r':\d+$', '', host)

        return host
    except Exception:
        return ""


def get_base_domain(url: str) -> str:
    """Extract the base domain (registrable domain) from a URL.

    This extracts the domain that can be registered (e.g., 'example.com' from
    'api.staging.example.com').

    Note: This is a simplified implementation. For production use with
    complex TLDs like .co.uk, consider using the 'tldextract' library.

    Args:
        url: The URL to extract base domain from

    Returns:
        Base domain string
    """
    domain = extract_domain(url)
    if not domain:
        return ""

    # Handle IP addresses
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', domain):
        return domain

    parts = domain.split('.')

    # Common multi-part TLDs (simplified list)
    multi_tlds = {
        'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
        'com.au', 'org.au', 'net.au',
        'co.nz', 'org.nz',
        'co.jp', 'or.jp',
        'com.br', 'org.br',
        'co.in', 'org.in',
    }

    # Check for multi-part TLD
    if len(parts) >= 3:
        potential_tld = '.'.join(parts[-2:])
        if potential_tld in multi_tlds:
            return '.'.join(parts[-3:])

    # Default: return last two parts
    if len(parts) >= 2:
        return '.'.join(parts[-2:])

    return domain


def is_same_site(url1: str, url2: str) -> bool:
    """Check if two URLs belong to the same site.

    Two URLs are considered same-site if they share the same base domain.

    Args:
        url1: First URL
        url2: Second URL

    Returns:
        True if URLs are same-site
    """
    return get_base_domain(url1) == get_base_domain(url2)


def normalize_url_for_crawl(url: str, base_url: Optional[str] = None) -> Optional[str]:
    """Normalize a URL for crawling, resolving relative URLs if needed.

    Args:
        url: The URL to normalize
        base_url: Base URL for resolving relative URLs

    Returns:
        Normalized absolute URL, or None if URL is invalid/unwanted
    """
    if not url:
        return None

    url = url.strip()

    # Skip non-http URLs
    if url.startswith(('mailto:', 'tel:', 'javascript:', 'data:', '#')):
        return None

    # Handle protocol-relative URLs
    if url.startswith('//'):
        url = 'https:' + url

    # Handle relative URLs
    if not url.startswith(('http://', 'https://')):
        if base_url:
            from urllib.parse import urljoin
            url = urljoin(base_url, url)
        else:
            return None

    return canonicalize_url(url)

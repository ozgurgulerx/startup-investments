"""PDF extraction helpers for crawler document parsing."""

from __future__ import annotations

from typing import Optional

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except Exception:
    fitz = None
    HAS_PYMUPDF = False


def extract_pdf_text(pdf_bytes: bytes, max_chars: int = 120000) -> Optional[str]:
    """Extract text from PDF bytes using PyMuPDF when available."""
    if not pdf_bytes or not HAS_PYMUPDF:
        return None

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        chunks = []
        total = 0
        for page in doc:
            text = page.get_text("text")
            if not text:
                continue
            clean = " ".join(text.split())
            if not clean:
                continue
            total += len(clean)
            chunks.append(clean)
            if total >= max_chars:
                break

        if not chunks:
            return None
        joined = "\n".join(chunks)
        return joined[:max_chars]
    except Exception:
        return None

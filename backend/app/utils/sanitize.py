"""Input sanitisation for free-text passed to LLM providers.

The goal is not to block prompt injection (impossible at the layer of
plain text), but to:

  • Strip control characters that confuse model tokenisers.
  • Clamp length so a malicious prompt cannot exhaust our token budget.
  • Remove obvious "system override" patterns so they at least don't
    arrive verbatim.

This is layered defence — the system prompt also tells the model to
ignore instructions in user content. Together they meaningfully reduce
the prompt-injection surface.
"""

from __future__ import annotations

import re

# Strip C0 + DEL control chars except tab/newline/carriage-return.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Common prompt-injection lead-ins. We rewrite them rather than reject
# the whole message so legitimate questions ("ignore prior typos…")
# still go through unscathed.
_INJECTION_PATTERNS = [
    re.compile(r"(?i)\bignore (all |the )?(previous|prior|above) (instructions|prompts?)"),
    re.compile(r"(?i)\bdisregard (all |the )?(previous|prior|above) (instructions|prompts?)"),
    re.compile(r"(?i)\b(reveal|print|show) (your|the) (system )?prompt"),
    re.compile(r"(?i)\bact as (an? )?(system|developer|admin|root)"),
]


def sanitize_user_text(text: str, *, max_len: int = 4000) -> str:
    """Sanitize free text before forwarding it to an LLM provider."""
    if not text:
        return ""
    cleaned = _CONTROL_RE.sub(" ", str(text))
    for pat in _INJECTION_PATTERNS:
        cleaned = pat.sub("[redacted instruction]", cleaned)
    cleaned = cleaned.strip()
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned

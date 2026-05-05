"""TRA tax-code mapping + EFD/Z-number validation.

Implements Pillar 1.2 (EFD/TRA Compliance) and 1.4 (Tax-Ready Categorization)
from BUSINESS_VALUE_PROPOSITION.md.

Why local rules instead of an LLM call: receipt scanning already costs one
LLM hop. Tax-code mapping is pure deterministic logic. Validation is a
regex. Keeping both local removes a hot-path API call per receipt.
"""

from __future__ import annotations

import re

# TRA-style category → tax-code line mapping. Aligns with the chart-of-
# accounts breakdown in BUSINESS_VALUE_PROPOSITION.md (Pillar 1.4).
TAX_CODE_MAP: dict[str, dict[str, str]] = {
    "fuel":         {"code": "OPEX-TRN", "line": "Transport & Fuel",        "vat_recoverable": "yes"},
    "transport":    {"code": "OPEX-TRN", "line": "Transport & Fuel",        "vat_recoverable": "yes"},
    "groceries":    {"code": "COGS",     "line": "Cost of Goods Sold",      "vat_recoverable": "yes"},
    "stock":        {"code": "COGS",     "line": "Cost of Goods Sold",      "vat_recoverable": "yes"},
    "utilities":    {"code": "OPEX-UTL", "line": "Rent & Utilities",        "vat_recoverable": "yes"},
    "rent":         {"code": "OPEX-UTL", "line": "Rent & Utilities",        "vat_recoverable": "no"},
    "salary":       {"code": "OPEX-PAY", "line": "Salaries & Wages",        "vat_recoverable": "no"},
    "marketing":    {"code": "OPEX-MKT", "line": "Marketing & Advertising", "vat_recoverable": "yes"},
    "office":       {"code": "OPEX-OFF", "line": "Office Supplies",         "vat_recoverable": "yes"},
    "restaurant":   {"code": "NON-DED",  "line": "Non-Deductible (entertainment)", "vat_recoverable": "no"},
    "entertainment":{"code": "NON-DED",  "line": "Non-Deductible (entertainment)", "vat_recoverable": "no"},
    "tax":          {"code": "TAX",      "line": "Tax payments",            "vat_recoverable": "no"},
    "capex":        {"code": "CAPEX",    "line": "Capital Expenditure",     "vat_recoverable": "yes"},
    "other":        {"code": "OPEX-OTH", "line": "Other Operating Expenses","vat_recoverable": "yes"},
}


# TRA Z-number on Tanzanian EFD receipts is alphanumeric, typically
# 8–14 chars, often prefixed with "Z" or "TIN". We accept either the
# parsed `tra_z_number` field from the receipt JSON or fall back to a
# scan of the raw `vendor`/`category` text. Pattern is intentionally
# permissive — TRA spec varies across EFD vendors.
_Z_NUMBER_RE = re.compile(r"\b(?:Z|EFD)?[-:\s]?([A-Z0-9]{8,14})\b", re.IGNORECASE)


def map_tax_code(category: str | None) -> dict[str, str]:
    """Return TRA code/line/VAT-recoverable hint for a receipt category."""
    key = (category or "other").strip().lower()
    return TAX_CODE_MAP.get(key, TAX_CODE_MAP["other"])


def validate_efd(receipt: dict) -> dict:
    """Decide if a receipt is EFD-compliant.

    Compliance signals (any one is sufficient):
      • `tra_z_number` set by the LLM extractor
      • A Z-number / TIN-shaped token in the vendor or items text
      • Tax (VAT) line > 0 — TRA receipts always show VAT explicitly
    """
    z = (receipt.get("tra_z_number") or "").strip()
    has_z = bool(z) and bool(_Z_NUMBER_RE.search(z))
    if not has_z:
        haystack = " ".join([
            str(receipt.get("vendor") or ""),
            " ".join(
                str(it.get("name") or "")
                for it in (receipt.get("items") or [])
            ),
        ])
        m = _Z_NUMBER_RE.search(haystack)
        if m:
            z = m.group(1).upper()
            has_z = True

    has_vat = False
    try:
        has_vat = float(receipt.get("tax") or 0) > 0
    except (TypeError, ValueError):
        has_vat = False

    compliant = has_z or has_vat
    return {
        "efd_compliant": compliant,
        "z_number": z or None,
        "has_vat_line": has_vat,
        "compliance_note": (
            "EFD-valid: TRA Z-number or VAT line present."
            if compliant else
            "Missing EFD/Z-number and VAT line — request a TRA-issued receipt."
        ),
    }


def annotate(receipt: dict) -> dict:
    """Mutate-in-place: add tax_code + EFD compliance fields to a receipt."""
    tc = map_tax_code(receipt.get("category"))
    efd = validate_efd(receipt)
    receipt["tax_code"] = tc["code"]
    receipt["tax_line"] = tc["line"]
    receipt["vat_recoverable"] = tc["vat_recoverable"]
    receipt["efd_compliant"] = efd["efd_compliant"]
    receipt["efd_z_number"] = efd["z_number"]
    receipt["efd_note"] = efd["compliance_note"]
    return receipt


def compliance_summary(receipts: list[dict]) -> dict:
    """Roll-up compliance stats across all of a user's receipts."""
    total = len(receipts)
    if not total:
        return {
            "total": 0, "compliant": 0, "non_compliant": 0,
            "compliance_rate": 0.0,
            "vat_recoverable_total": 0.0,
            "by_tax_line": {},
            "non_compliant_examples": [],
        }
    compliant = 0
    vat_recoverable_total = 0.0
    by_line: dict[str, float] = {}
    non_compliant_examples: list[dict] = []
    for r in receipts:
        info = annotate(dict(r))  # avoid mutating caller's copy
        amt = float(r.get("total") or 0)
        if info["efd_compliant"]:
            compliant += 1
        elif len(non_compliant_examples) < 5:
            non_compliant_examples.append({
                "vendor": r.get("vendor"),
                "date": r.get("date"),
                "amount": amt,
                "reason": info["efd_note"],
            })
        if info["vat_recoverable"] == "yes":
            vat_recoverable_total += float(r.get("tax") or 0)
        line = info["tax_line"]
        by_line[line] = by_line.get(line, 0.0) + amt
    return {
        "total": total,
        "compliant": compliant,
        "non_compliant": total - compliant,
        "compliance_rate": round(compliant / total, 4) if total else 0.0,
        "vat_recoverable_total": round(vat_recoverable_total, 2),
        "by_tax_line": {k: round(v, 2) for k, v in by_line.items()},
        "non_compliant_examples": non_compliant_examples,
    }

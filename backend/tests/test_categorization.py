"""Regression tests for the tiers in `analytics.categorize`.

Runs with plain Python — no pytest dependency, same as the other suites here:

    backend/venv/Scripts/python.exe backend/tests/test_categorization.py

`categorize` consults four tiers in order: exact CATEGORY_KEYWORDS, the broad
verb/preposition FALLBACK_PATTERNS, bank brand names, then OCR-tolerant fuzzy
matching. The tier a rule lives in — not just its position within a list — is
what decides the outcome, and that is the thing this file pins down.

The bug behind it: "Bank Services" was the LAST entry of CATEGORY_KEYWORDS,
with a comment saying it sat there so every specific category got first shot at
narrations like "TO CRDB A/C ...". But the rule that actually catches that
string (" to " -> Transfers) lives in FALLBACK_PATTERNS, and the WHOLE keyword
table is consulted before the first fallback. Last-in-the-list was not last.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.analytics import (  # noqa: E402
    CATEGORY_COLOURS,
    UNCATEGORIZED,
    categorize,
)

_failures: list[str] = []


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def test_bank_brands_lose_to_the_transfer_fallback() -> None:
    """A brand names the counterparty's institution, not what the money did."""
    print("bank brands are the weakest signal")
    # The exact narration the old comment cited as its own motivation.
    check("outgoing transfer to a bank", categorize("TO CRDB A/C 0150123456")[0],
          "Transfers")
    check("NMB transfer", categorize("TO NMB A/C 20101234567")[0], "Transfers")
    check("incoming from a bank", categorize("RECEIVED FROM NBC BANK")[0],
          "Income")

    # ...but a narration with no verb and no other signal still lands there.
    check("bare brand", categorize("CRDB BANK")[0], "Bank Services")
    check("brand with a branch", categorize("STANBIC BRANCH MSIMBAZI")[0],
          "Bank Services")


def test_specific_categories_still_win() -> None:
    """Moving the brand tier must not weaken anything above it."""
    print("specific categories keep priority")
    check("ATM withdrawal", categorize("NMB ATM CASH WITHDRAWAL")[0], "Withdrawal")
    check("bank charge", categorize("CRDB LEDGER FEE")[0], "Fees & Charges")
    check("salary", categorize("SALARY NMB JULY")[0], "Salary")


def test_bank_services_is_still_a_real_category() -> None:
    """It left CATEGORY_KEYWORDS, so it must be carried into CATEGORY_COLOURS.

    llm_categorizer's prompt instructs the model to answer "Bank Services";
    without a colour here that answer fails validation and the LLM's own
    category would be thrown away.
    """
    print("Bank Services survives the move")
    check("has a colour", "Bank Services" in CATEGORY_COLOURS, True)
    check("colour matches", categorize("CRDB BANK")[1],
          CATEGORY_COLOURS["Bank Services"])


def test_unknown_stays_unknown() -> None:
    print("no accidental catch-all")
    check("gibberish", categorize("XZQ 88817")[0], UNCATEGORIZED)
    check("empty", categorize("")[0], UNCATEGORIZED)
    check("none", categorize(None)[0], UNCATEGORIZED)


def main() -> int:
    for fn in (
        test_bank_brands_lose_to_the_transfer_fallback,
        test_specific_categories_still_win,
        test_bank_services_is_still_a_real_category,
        test_unknown_stays_unknown,
    ):
        fn()
    print()
    if _failures:
        print(f"{len(_failures)} FAILURE(S):")
        for f in _failures:
            print("  -", f)
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

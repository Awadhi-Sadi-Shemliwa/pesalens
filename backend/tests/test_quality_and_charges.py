"""Regression tests for extraction-quality reporting and the charges blind spot.

Runs with plain Python — no pytest dependency, same as test_ocr_extraction.py:

    backend/venv/Scripts/python.exe backend/tests/test_quality_and_charges.py

Covers the three things that make an extraction honest about itself:

1. **Amount provenance.** A debit/credit RECONSTRUCTED from the running balance
   (validator's delta repair, or the chain solver deriving/repairing) is tagged
   `amount_inferred`. A direction FLIP is not — it preserves a genuinely-read
   amount and must stay measurable.
2. **The charges blind spot.** `_charges_and_interest` finds bank fees in the
   gap between the expected and printed balance. An inferred row's gap is zero
   by construction, so the fee inside it is unrecoverable — the detector must
   exclude the row and REPORT the omission rather than quietly under-count.
3. **One metrics implementation.** `analytics.compute_metrics` and
   `pipeline._compute_extraction_metrics` must agree exactly, or the number the
   UI shows would not be the number the pipeline computed.

Note there is no test for correcting a row: extracted transactions are
deliberately read-only. See the module docstring in routers/dashboard.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.transaction import StatementMetadata, Transaction  # noqa: E402
from app.services.analytics import (  # noqa: E402
    _charges_and_interest,
    _quality_block,
    compute_metrics,
)
from app.services.chain_solver import solve_balance_chain  # noqa: E402
from app.services.pipeline import _compute_extraction_metrics  # noqa: E402
from app.services.validator import validate_transactions  # noqa: E402

_failures: list[str] = []


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def _txn(idx: int, **kw) -> Transaction:
    kw.setdefault("description", f"row {idx}")
    return Transaction(row_index=idx, **kw)


# ---------------------------------------------------------------- provenance

def test_validator_tags_inferred_amounts() -> None:
    print("validator amount provenance")

    # Row 2 lost BOTH its debit and credit cell; the validator fills it from the
    # balance delta (1000 -> 700 = a 300 debit). That number was computed, not
    # read — so it must be tagged.
    txns = [
        _txn(1, debit=200.0, balance=1000.0),
        _txn(2, balance=700.0),
        _txn(3, credit=50.0, balance=750.0),
    ]
    out, _errors = validate_transactions(txns, opening_balance=1200.0)
    check("delta repair filled debit", out[1].debit, 300.0)
    check("delta repair tagged", out[1].amount_inferred, True)
    check("clean row untagged", out[0].amount_inferred, False)
    check("clean row 3 untagged", out[2].amount_inferred, False)

    # A direction FLIP keeps the amount the page actually printed — only the
    # column was wrong. Tagging it would blind the charges detector to a row it
    # can still measure perfectly well.
    txns = [_txn(1, credit=300.0, balance=700.0)]
    out, _errors = validate_transactions(txns, opening_balance=1000.0)
    check("flip corrected direction", (out[0].debit, out[0].credit), (300.0, None))
    check("flip NOT tagged inferred", out[0].amount_inferred, False)


def test_chain_solver_tags_inferred_amounts() -> None:
    print("chain solver amount provenance")

    # Exactly one amount-less row in the segment — the solver derives it.
    # It must sit MID-document: trailing movement-less rows are dropped as
    # page-footer noise before anchoring (see chain_solver fragment removal).
    txns = [_txn(1, balance=5000.0), _txn(2, debit=1000.0, balance=4000.0)]
    out = solve_balance_chain(txns, opening_balance=10000.0)
    check("derived amount", out.transactions[0].debit, 5000.0)
    check("derived amount tagged", out.transactions[0].amount_inferred, True)
    check("read amount untagged", out.transactions[1].amount_inferred, False)

    # A fully consistent chain invents nothing, so nothing gets tagged.
    txns = [
        _txn(1, debit=1000.0, balance=9000.0),
        _txn(2, credit=500.0, balance=9500.0),
    ]
    out = solve_balance_chain(txns, opening_balance=10000.0)
    check(
        "clean chain untagged",
        [t.amount_inferred for t in out.transactions],
        [False, False],
    )


# ------------------------------------------------------------------- charges

def test_charges_exclude_inferred_rows() -> None:
    print("charges blind spot")

    # Row 1 carries a READ debit of 1000 but the balance drops 1015 — the extra
    # 15 is a silent fee, and it is measurable.
    result = {
        "metadata": {"opening_balance": 10000.0},
        "transactions": [
            {"row_index": 1, "description": "ATM WITHDRAWAL",
             "debit": 1000.0, "balance": 8985.0},
        ],
    }
    out = _charges_and_interest(result)
    check("fee on a read row detected", out["total_charges"], 15.0)
    check("fee occurrence counted", out["charge_occurrences"], 1)
    check("no blind spot claimed", out["blind_spot"], False)
    check("no inferred rows", out["inferred_rows"], 0)

    # Same statement, but row 1's amount was reconstructed from the balance —
    # so the 1015 movement already swallowed the fee. There is no gap left to
    # measure, and pretending otherwise would report a confident zero.
    result = {
        "metadata": {"opening_balance": 10000.0},
        "transactions": [
            {"row_index": 1, "description": "ATM WITHDRAWAL",
             "debit": 1015.0, "balance": 8985.0, "amount_inferred": True},
        ],
    }
    out = _charges_and_interest(result)
    check("inferred row yields no fee", out["total_charges"], 0.0)
    check("inferred row counted", out["inferred_rows"], 1)
    check("blind spot flagged", out["blind_spot"], True)
    check("insight says minimum", "minimum" in out["insight"], True)

    # An inferred row must not break the running balance for the rows AFTER it:
    # the walk still carries its balance forward, so a later fee is still found.
    result = {
        "metadata": {"opening_balance": 10000.0},
        "transactions": [
            {"row_index": 1, "description": "INFERRED",
             "debit": 1000.0, "balance": 9000.0, "amount_inferred": True},
            {"row_index": 2, "description": "POS PURCHASE",
             "debit": 500.0, "balance": 8480.0},
        ],
    }
    out = _charges_and_interest(result)
    check("later fee still detected", out["total_charges"], 20.0)
    check("still reports the blind spot", out["inferred_rows"], 1)

    # Legacy results carry no `amount_inferred` key at all — they must read
    # exactly as they did before the field existed.
    result = {
        "metadata": {"opening_balance": 10000.0},
        "transactions": [
            {"row_index": 1, "description": "OLD ROW",
             "debit": 1000.0, "balance": 8985.0},
        ],
    }
    out = _charges_and_interest(result)
    check("legacy result unchanged", out["estimated_total"], 15.0)


# ------------------------------------------------------------------- metrics

def test_metrics_single_implementation() -> None:
    print("metrics parity")

    txns = [
        _txn(1, debit=100.0, balance=900.0),
        _txn(2, credit=50.0, balance=950.0, needs_review=True),
        _txn(3, debit=25.0, balance=925.0, amount_inferred=True),
    ]
    md = StatementMetadata(opening_balance=1000.0, closing_balance=925.0)

    from_pipeline = _compute_extraction_metrics(txns, md)
    from_analytics = compute_metrics(
        [t.model_dump(mode="json") for t in txns], md.model_dump(mode="json")
    )
    check("pipeline delegates to analytics", from_pipeline, from_analytics)

    check("row count", from_pipeline["rows"], 3)
    check("net flow", from_pipeline["net_flow"], -75.0)
    check("balance span", from_pipeline["balance_span"], -75.0)
    check("statement balances", from_pipeline["net_vs_span_diff"], 0.0)
    check("review count", from_pipeline["needs_review"], 1)
    check("inferred count", from_pipeline["inferred_rows"], 1)
    # Read-only means no edit provenance is tracked at all.
    check("no edit tracking", "edited_rows" in from_pipeline, False)

    # No opening/closing on the statement → nothing to check against. That is
    # "unknown", NOT "failed", and the quality block must say so with None.
    bare = compute_metrics([t.model_dump(mode="json") for t in txns], {})
    check("span unknown without balances", bare["balance_span"], None)
    q = _quality_block({"transactions": []}, [t.model_dump(mode="json") for t in txns])
    check("balances verdict is None when unknowable", q["balances"], None)


def test_quality_block_reports_the_gap() -> None:
    print("quality block")

    # The statement's own balances span 1000 -> 900, i.e. -100. The rows only
    # add up to -75 (a 100 debit against a 25 credit), so 25 went missing —
    # exactly the situation `metrics.net_vs_span_diff` exists to announce.
    txns = [
        {"row_index": 1, "debit": 100.0, "balance": 900.0, "needs_review": True,
         "review_reason": "Chain mismatch: segment off by 25.00"},
        {"row_index": 2, "credit": 25.0, "balance": 925.0},
    ]
    result = {
        "metadata": {"opening_balance": 1000.0, "closing_balance": 900.0},
        "transactions": txns,
        "validation_errors": ["Row 1: balance mismatch"],
        "validation_passed": False,
    }
    q = _quality_block(result, txns)
    check("gap surfaced", q["net_vs_span_diff"], 25.0)
    check("does not balance", q["balances"], False)
    check("review rows surfaced", q["needs_review_rows"], 1)
    check("errors passed through", len(q["validation_errors"]), 1)

    # A better extraction of the same statement (a digital PDF rather than a
    # scan) reads row 1 as the 125 it really was and the statement reconciles.
    # This is the ONLY way the gap closes: a better read, never a user edit.
    txns[0] = {**txns[0], "debit": 125.0, "needs_review": False,
               "review_reason": None}
    q = _quality_block(result, txns)
    check("gap closed by a better read", q["net_vs_span_diff"], 0.0)
    check("now balances", q["balances"], True)
    check("nothing left flagged", q["needs_review_rows"], 0)


def main() -> int:
    for fn in (
        test_validator_tags_inferred_amounts,
        test_chain_solver_tags_inferred_amounts,
        test_charges_exclude_inferred_rows,
        test_metrics_single_implementation,
        test_quality_block_reports_the_gap,
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

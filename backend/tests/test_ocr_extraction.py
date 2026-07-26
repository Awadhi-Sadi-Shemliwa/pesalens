"""Regression tests for the scanned-statement (OCR) extraction path.

Runs with plain Python — no pytest dependency:

    backend/venv/Scripts/python.exe backend/tests/test_ocr_extraction.py

Covers the pieces that make garbled scans readable: OCR-tolerant amount and
date parsing, amount-column calibration, and the balance-chain solver's
resolution cases. Every case here is drawn from a real NMB scan.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.transaction import Transaction  # noqa: E402
from app.services.chain_solver import (  # noqa: E402
    _is_leading_digit_corruption,
    _repair_from_neighbour,
    solve_balance_chain,
)
from app.services.classifier import (  # noqa: E402
    GARBLED_BORDERLINE,
    GARBLED_QUALITY_MIN,
    text_quality,
)
from app.services.normalizer import _drop_outlier_dates  # noqa: E402
from app.services.row_builder import (  # noqa: E402
    _finalize_word_txn,
    _merge_numeric_fragments,
    AmountColumnCalibration,
    WordColumnMap,
    calibrate_amount_columns,
    parse_amount,
    parse_amount_ocr,
    parse_date_fuzzy,
)

_failures: list[str] = []


def check(label: str, got, want) -> None:
    if got != want:
        _failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {label}")


def test_parse_amount_ocr() -> None:
    print("parse_amount_ocr")
    # Mixed OCR separators ('.' and ',' both used as grouping).
    check("mixed separators", parse_amount_ocr("56.846,403.27"), 56846403.27)
    # Dots as thousands separators (OCR reads commas as periods).
    check("dot grouping", parse_amount_ocr("51.266.685.17"), 51266685.17)
    check("single dot group", parse_amount_ocr("366.100"), 366100.0)
    # Normal amounts still parse identically.
    check("plain", parse_amount_ocr("1,234.56"), 1234.56)
    # A date must never be read as an amount.
    check("date rejected", parse_amount_ocr("07.06.2026"), None)
    # Separator-less garble is refused so the chain solver derives it.
    check("garble rejected", parse_amount_ocr("52.5223576"), None)
    check("junk rejected", parse_amount_ocr("abc"), None)
    # Strict parser is untouched (digital path).
    check("strict unchanged", parse_amount("07.06.2026"), None)


def test_parse_amount_digital_is_strict() -> None:
    """A period in a DIGITAL cell is a decimal point, never a misread comma.

    The dot-as-thousands repairs above exist because OCR reads grouping commas
    as periods. Applying them to a machine-readable cell would multiply a
    genuine 3-decimal value — a unit price, an FX rate, a 3-dp sub-account
    balance — by 1000. `_row_to_transaction` (the Tier-1 digital table path)
    calls parse_amount, so the repairs must stay behind parse_amount_ocr.
    """
    print("parse_amount (digital, strict)")
    # The 1000x silent error this guards against.
    check("3 decimals preserved", parse_amount("1.234"), 1.234)
    check("no thousands repair", parse_amount("366.100"), 366.1)
    # Multi-dot grouping is an OCR artefact too: refuse rather than invent.
    check("multi-dot refused", parse_amount("51.266.685.17"), None)
    # Ordinary money is unaffected.
    check("plain decimal", parse_amount("1,234.56"), 1234.56)
    check("whole number", parse_amount("1234"), 1234.0)
    # ...while the OCR parser still repairs the very same strings.
    check("ocr still repairs", parse_amount_ocr("366.100"), 366100.0)


def test_merge_numeric_fragments() -> None:
    """OCR-split amount fragments reunite, but separate cells must not fuse.

    The regression this guards: a genuine ~2,000 cell sitting next to a stray
    '0.000' fragment used to concatenate into '2,000.000', which
    parse_amount_ocr then promotes to 2,000,000 — a silent 1000x inflation the
    chain solver would try to reconcile the rest of the segment against.
    """
    print("_merge_numeric_fragments")
    # Legitimate reunification of one number OCR broke across boxes: grouping
    # fragments left of a single 2-digit decimal tail.
    check("split amount reunited",
          _merge_numeric_fragments(["1,234,", "567.89"]), "1,234,567.89")
    check("grouping-only reunited",
          _merge_numeric_fragments(["1,234", "567"]), "1,234567")
    # The inflation case: a 3-digit '.000' tail is grouping-shaped, not a real
    # decimal, so the pieces stay apart (space-join) and parse to no amount.
    check("no 2,000.000 synthesis",
          _merge_numeric_fragments(["2,000", "0.000"]), "2,000 0.000")
    check("inflated amount not parsed",
          parse_amount_ocr(_merge_numeric_fragments(["2,000", "0.000"])), None)
    # A dot in a non-trailing fragment means these aren't one number's parts.
    check("leading-dot fragment kept apart",
          _merge_numeric_fragments(["2.228", "000"]), "2.228 000")
    # Non-numeric tokens (a description that strayed into the amount cell) keep
    # their spacing untouched.
    check("non-numeric space-joined",
          _merge_numeric_fragments(["PESA", "500"]), "PESA 500")


def test_parse_date_fuzzy() -> None:
    print("parse_date_fuzzy")
    check("clean", parse_date_fuzzy("05/06/2026"), (dt.date(2026, 6, 5), False))
    # OCR letter-for-digit substitutions.
    check("O for 0", parse_date_fuzzy("O5/O6/2026"), (dt.date(2026, 6, 5), True))
    # '/' misread as '1'.
    check("slash as one", parse_date_fuzzy("0310712026"), (dt.date(2026, 7, 3), True))
    # Date buried in a merged digit blob.
    check("blob", parse_date_fuzzy("021071202602107/2026"), (dt.date(2026, 7, 2), True))
    # Reference/phone numbers must not yield dates.
    check("phone rejected", parse_date_fuzzy("255784018319"), (None, False))
    check("time rejected", parse_date_fuzzy("14:11:36"), (None, False))


def test_amount_calibration() -> None:
    print("calibrate_amount_columns")
    # Header anchors sit left of the right-aligned values (real geometry).
    wcmap = WordColumnMap(columns=[
        ("date", 70.0, 90.0),
        ("description", 180.0, 300.0),
        ("debit", 341.0, 360.0),
        ("credit", 394.0, 415.0),
        ("balance", 441.0, 465.0),
    ])
    words = []
    for i in range(6):
        top = 300.0 + i * 12
        # Debit values end ~388, credit ~435, balance ~496 (measured).
        words.append({"text": "193,220.42", "x0": 359.0, "x1": 388.1, "top": top, "bottom": top + 8})
        words.append({"text": "1,400,000", "x0": 410.0, "x1": 435.8, "top": top, "bottom": top + 8})
        words.append({"text": "51,266,685.17", "x0": 458.9, "x1": 495.7, "top": top, "bottom": top + 8})
    calib = calibrate_amount_columns(words, wcmap, header_y=234.0, y_tolerance=3.0)
    check("calibrated", calib is not None, True)
    if calib:
        roles = [r for r, _ in calib.edges]
        check("role order", roles, ["debit", "credit", "balance"])
        # The failure this fixes: a wide debit whose x0 (359) sits past the
        # header midpoint (367) used to be assigned to credit.
        check("wide debit -> debit", calib.role_for_x1(388.1), "debit")
        check("credit -> credit", calib.role_for_x1(435.8), "credit")
        check("balance -> balance", calib.role_for_x1(495.7), "balance")

    # Too few numbers to cluster: refuse rather than guess.
    check("sparse refused", calibrate_amount_columns(words[:2], wcmap, 234.0, 3.0), None)


def test_leading_digit_helpers() -> None:
    print("leading-digit repair")
    # Dropped leading digits: '1,524,191.17' read for 91,524,191.17.
    check("dropped digits", _is_leading_digit_corruption(91524191.17, 1524191.17), True)
    # Swapped leading digit: 90,714,001.15 read for 50,714,001.15.
    check("swapped leading", _is_leading_digit_corruption(50714001.15, 90714001.15), True)
    # Unrelated magnitudes must not match.
    check("unrelated", _is_leading_digit_corruption(51266685.17, 42.0), False)
    # Neighbour reconstruction borrows at most two digits...
    check("borrow one", _repair_from_neighbour(1320765.15, 81720765.15, 81318783.15), 81320765.15)
    # ...and refuses to invent a balance out of a tiny reading.
    check("refuse tiny", _repair_from_neighbour(39.58, 89782424.27, 89554424.27), None)


def test_text_quality_gate() -> None:
    """Only real mojibake may be condemned as a garbled text layer.

    A false GARBLED verdict throws away a page's genuine embedded text and
    routes it to OCR; if OCR is unavailable the statement then extracts
    nothing and the job fails outright — a statement that used to work. So
    reference codes, account numbers and hyphenated product names have to
    read as content, not junk.
    """
    print("text_quality gate")

    reference_heavy = """
    Date Value Date Description Reference Debit Credit Balance
    01/06/2026 01/06/2026 M-PESA TRANSFER TO 255784018319 FT26183ABCD01 50,000.00
    02/06/2026 02/06/2026 A/C 01-2345-6789 CHARGE FT26184XYZ99 2,360.00
    03/06/2026 03/06/2026 ATM W/D MBEZI 528/03 REF-882713-01 100,000.00
    """
    mojibake = (
        "CL}STOM HR AGC*{J $-;? STATE F*I H}dT }{ *@# ;;/ ]|[ ~~ q@w e$r "
        "t%y u^i o&p a*s d(f g)h j+k l=m z<x c>v b?n"
    )

    check("reference-heavy reads as digital",
          text_quality(reference_heavy) >= GARBLED_BORDERLINE, True)
    check("mojibake reads as garbled",
          text_quality(mojibake) < GARBLED_QUALITY_MIN, True)
    # Too little text to judge — never condemn on a handful of tokens.
    check("short input trusted", text_quality("Total 1,234.00"), 1.0)


def test_drop_outlier_dates() -> None:
    """Only wrong-YEAR dates are dropped; a clustered period is left alone.

    The regression guarded here: keying the window on percentiles trims by
    transaction DENSITY, but a statement period is a contiguous RANGE. On a
    statement whose activity piles up on paydays, the upper percentile
    collapses onto the pile and genuine month-end rows get their dates deleted
    and are flagged for review — silent damage to a correct extraction.
    """
    print("_drop_outlier_dates")

    def dropped(dates: list[dt.date]) -> int:
        txns = [Transaction(row_index=i, description="x", txn_date=d)
                for i, d in enumerate(dates)]
        _drop_outlier_dates(txns)
        return sum(1 for t in txns if t.txn_date is None)

    # Quarterly statement, 80 rows on one payday + a spread tail. Every date is
    # real and every one must survive. (The percentile version dropped 3.)
    payday = [dt.date(2026, 1, 31)] * 80
    tail = [dt.date(2026, 1, 1) + dt.timedelta(days=i * 4) for i in range(22)]
    check("payday-clustered quarter kept", dropped(payday + tail), 0)

    # A busy first month followed by a thinner tail — one contiguous period.
    busy = [dt.date(2026, 1, 1) + dt.timedelta(days=i % 28) for i in range(90)]
    thin = [dt.date(2026, 2, 1) + dt.timedelta(days=i * 3) for i in range(18)]
    check("busy-month quarter kept", dropped(busy + thin), 0)

    # A full year, evenly spread.
    check("annual statement kept",
          dropped([dt.date(2026, 1, 1) + dt.timedelta(days=i * 3)
                   for i in range(120)]), 0)

    # A genuinely sparse account: every block is small, so no block is a clear
    # minority and nothing may be discarded.
    check("sparse account kept",
          dropped([dt.date(2026, 1, 1) + dt.timedelta(days=i * 60)
                   for i in range(6)]), 0)

    # What the pass exists for: a garbled year among an otherwise clean month.
    clean = [dt.date(2026, 7, 1) + dt.timedelta(days=i % 30) for i in range(40)]
    check("garbled year dropped", dropped(clean + [dt.date(2020, 7, 5)]), 1)

    # The reference statement's real shape: a May-July body plus one row whose
    # day+month OCR'd into August, stranded 46 days past every other date.
    fixture = (
        [dt.date(2026, 5, 21)] * 2
        + [dt.date(2026, 6, 7) + dt.timedelta(days=i % 22) for i in range(74)]
        + [dt.date(2026, 7, 1) + dt.timedelta(days=i % 3) for i in range(12)]
    )
    check("stranded month dropped", dropped(fixture + [dt.date(2026, 8, 18)]), 1)
    check("...and the body is untouched", dropped(fixture), 0)

    # Too few rows to judge: never guess.
    check("under 5 rows untouched",
          dropped([dt.date(2026, 7, 1), dt.date(2020, 1, 1)]), 0)


def test_fuzzy_date_is_disclosed() -> None:
    """A guessed date must reach the user, and survive chain confirmation.

    `parse_date_fuzzy` reconstructs '0310712026' as 03/07/2026 — plausible, but
    a guess. The review surface renders a reason only when `needs_review` is
    set, so recording the reason alone showed the user nothing; and the chain
    solver's `_mark` overwrites `review_reason` on any row it does NOT consider
    flagged, so an unflagged reason was erased the moment the arithmetic
    checked out.
    """
    print("fuzzy date disclosure")

    row = _finalize_word_txn(
        {"date": "0310712026", "description": "NMB ATM Cash Withdrawal",
         "debit": "1,000", "balance": "99,000",
         "_date_obj": "2026-07-03", "_date_fuzzy": "1", "_raw": "raw"},
        1, 1, ocr=True,
    )
    check("date recovered", str(row.txn_date), "2026-07-03")
    check("flagged for review", row.needs_review, True)
    check("reason recorded", row.review_reason,
          "Date recovered from OCR-garbled text")

    # Now let the chain confirm the arithmetic: the row reconciles perfectly,
    # but its DATE is still a guess and must stay disclosed.
    out = solve_balance_chain([row], opening_balance=100000.0)
    kept = out.transactions[0]
    check("still flagged after chain confirms", kept.needs_review, True)
    check("reason survives chain confirmation", kept.review_reason,
          "Date recovered from OCR-garbled text")


def _txn(idx: int, debit=None, credit=None, balance=None, desc="") -> Transaction:
    return Transaction(row_index=idx, description=desc, debit=debit,
                       credit=credit, balance=balance)


def test_chain_solver() -> None:
    print("solve_balance_chain")
    # Case: direction flipped by the OCR column split — the chain proves it.
    txns = [_txn(1, credit=1000.0, balance=99000.0)]
    out = solve_balance_chain(txns, opening_balance=100000.0)
    check("flip debit/credit", (txns[0].debit, txns[0].credit), (1000.0, None))
    # ...and the user is told. Money that moved the opposite way to what the
    # statement appeared to say is the single most consequential thing the
    # solver does, and both clients render review_reason ONLY when
    # needs_review is set — so a reason without the flag is invisible. Same
    # policy as validator's own flip.
    check("flip is flagged", txns[0].needs_review, True)
    check("flip reason shown", txns[0].review_reason,
          "Direction corrected by balance chain")

    # A confirmed segment must not ERASE a reason an earlier stage recorded
    # without raising a flag (validator's "Amount inferred from balance
    # delta"). Confirmation passes reason=None, which used to overwrite it.
    txn = _txn(1, debit=1000.0, balance=99000.0)
    txn.review_reason = "Amount inferred from balance delta"
    out = solve_balance_chain([txn], opening_balance=100000.0)
    check("confirmation keeps an upstream reason", txn.review_reason,
          "Amount inferred from balance delta")
    check("confirmation still raises no flag", txn.needs_review, False)

    # Case: amount truncated by a clipped OCR box ('2.228' for 2,228,000).
    txns = [_txn(1, debit=2.228, balance=97772000.0)]
    out = solve_balance_chain(txns, opening_balance=100000000.0)
    check("truncated amount", txns[0].debit, 2228000.0)

    # Case: missing amount derived from the balance delta. A mid-document
    # row like this must NOT be discarded — the chain can reconstruct it.
    txns = [_txn(1, balance=95000.0), _txn(2, debit=1000.0, balance=94000.0)]
    out = solve_balance_chain(txns, opening_balance=100000.0)
    check("derived amount", txns[0].debit, 5000.0)
    check("mid-document row kept", len(out.transactions), 2)

    # Case: single-digit balance corruption repaired from the movements.
    txns = [_txn(1, debit=1000.0, balance=62732287.27)]
    out = solve_balance_chain(txns, opening_balance=52733287.27)
    check("balance repaired", txns[0].balance, 52732287.27)

    # Case: opening-balance pseudo-row (OCR-garbled label) is recognised,
    # removed, and used as the anchor.
    txns = [_txn(1, balance=51266685.17, desc="OPENNG BALANCE"),
            _txn(2, debit=685.17, balance=51266000.0)]
    out = solve_balance_chain(txns, opening_balance=None)
    check("opening anchored", out.opening_balance, 51266685.17)
    check("pseudo-row removed", len(out.transactions), 1)

    # Case: trailing dateless, movement-less footer noise is dropped, so its
    # garbled balance can never become the closing balance.
    txns = [_txn(1, debit=100.0, balance=99900.0),
            _txn(2, balance=560224032.0, desc="RECEVED"),
            _txn(3, desc="0")]
    out = solve_balance_chain(txns, opening_balance=100000.0)
    check("noise dropped", len(out.transactions), 1)
    check("closing sane", out.closing_balance, 99900.0)

    # Nothing provable: values are kept as read and flagged, never invented.
    txns = [_txn(1, debit=123.0, balance=None), _txn(2, debit=456.0, balance=None)]
    out = solve_balance_chain(txns, opening_balance=None)
    check("raw kept", [t.debit for t in out.transactions], [123.0, 456.0])

    # Case: the walk ends on an unresolved suspect with real rows AFTER it.
    # Only the rows up to the suspect may be reconciled against the suspect's
    # balance (_solve_segment's stated precondition); the rows that follow it
    # must still reach the closing balance. Reconciling the whole stretch
    # against a balance recorded BEFORE those rows happened cannot prove out,
    # so it flagged them all and then dropped their movements entirely.
    txns = [
        _txn(1, debit=1000.0, balance=99000.0),
        _txn(2, debit=500.0, balance=900000000.0),   # corrupt → suspect
        _txn(3, debit=200.0),
        _txn(4, debit=300.0),
    ]
    out = solve_balance_chain(txns, opening_balance=100000.0)
    check("trailing movements reach closing", out.closing_balance, 899999500.0)
    check("only the suspect is flagged",
          [t.row_index for t in out.transactions if t.needs_review], [2])


def main() -> int:
    for fn in (test_parse_amount_ocr, test_parse_amount_digital_is_strict,
               test_merge_numeric_fragments,
               test_parse_date_fuzzy, test_text_quality_gate,
               test_drop_outlier_dates,
               test_fuzzy_date_is_disclosed, test_amount_calibration,
               test_leading_digit_helpers, test_chain_solver):
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

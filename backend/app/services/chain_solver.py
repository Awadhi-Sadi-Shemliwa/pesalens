"""Balance-chain reconciliation for OCR'd (scanned) statements.

The running balance is the statement's own checksum: every row satisfies
    balance = prev_balance - debit + credit
OCR corrupts individual readings (truncated amounts like '2.228' for
2,228,000, single-digit balance substitutions, amounts dropped entirely,
debits landing in the credit column), but the chain constraint lets us
recover the truth deterministically. This solver walks the transaction
list in segments between trusted balance readings and, per segment,
confirms / flips / derives / repairs the readings — flagging (never
inventing) whatever it cannot prove.

Runs ONLY for documents with scanned pages; digital extractions never
enter here.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from itertools import combinations

from app.schemas.transaction import Transaction
from app.utils.logger import get_logger

log = get_logger(__name__)

_TOL = 1.0          # TZS rounding tolerance, matches validator
_MAX_FLIP_ROWS = 6  # cap combinatorial flip search per segment
# Segment mismatches below this are misread amounts (flag in place); above
# it the segment-end BALANCE is the prime suspect (defer anchoring).
_DEFER_MIN = 100_000.0


@dataclass
class ChainOutcome:
    transactions: list[Transaction]
    corrections: list[str] = field(default_factory=list)
    opening_balance: float | None = None
    closing_balance: float | None = None


def _digit_distance(a: float, b: float) -> int:
    """Differing digit positions between two amounts' canonical forms.

    Returns a large number when the magnitudes differ structurally (different
    length), so only true single-digit OCR substitutions score 1.
    """
    sa, sb = f"{a:.2f}", f"{b:.2f}"
    if len(sa) != len(sb):
        return 99
    return sum(1 for ca, cb in zip(sa, sb) if ca != cb)


def _is_leading_digit_corruption(expected: float, reading: float) -> bool:
    """Is `reading` an OCR corruption of `expected` in its LEADING digits?

    Two signatures, both cheap to prove and impossible to hit by accident
    on unrelated magnitudes:

      • dropped leading digits — the reading's digits are a strict suffix of
        the expected value's ('1,524,191.17' read for 91,524,191.17);
      • swapped leading digit — same length, differs only in the first digit
        ('90,714,001.15' read for 50,714,001.15).

    Both keep every trailing digit intact, which is exactly how OCR fails on
    a right-aligned number whose leading glyphs are faint or clipped.
    """
    if expected <= 0 or reading <= 0:
        return False
    se, sr = f"{expected:.2f}", f"{reading:.2f}"
    if len(sr) < len(se) and se.endswith(sr):
        return True
    if len(se) == len(sr) and se[0] != sr[0] and se[1:] == sr[1:]:
        return True
    return False


def _repair_from_neighbour(
    reading: float, prev_b: float, next_b: float,
) -> float | None:
    """Rebuild a spiked balance's leading digits from its neighbours.

    Takes the reading's trailing digits (which OCR gets right — they are
    the cleanly-printed low-order glyphs) and borrows enough leading digits
    from a neighbouring balance to restore the magnitude. The candidate is
    accepted only when it lands within the neighbours' own range plus a
    margin, so a genuine large movement is never "repaired" away.
    """
    sr = f"{reading:.2f}"
    # The reading must still carry most of the number for a reconstruction
    # to be evidence rather than invention: refuse to rebuild '39.58' into
    # an 8-figure balance.
    if len(sr) < 8:
        return None
    lo, hi = (prev_b, next_b) if prev_b <= next_b else (next_b, prev_b)
    margin = max(0.1 * max(abs(lo), abs(hi)), 1_000_000.0)
    best: float | None = None
    for ref in (prev_b, next_b):
        s_ref = f"{ref:.2f}"
        if len(s_ref) < len(sr) or len(s_ref) - len(sr) > 2:
            continue  # borrow at most two leading digits
        if len(s_ref) == len(sr):
            # Same length: try swapping only the leading digit.
            cand_s = s_ref[0] + sr[1:]
        else:
            # Reading lost leading digits — borrow them from the reference.
            cand_s = s_ref[: len(s_ref) - len(sr)] + sr
        try:
            cand = float(cand_s)
        except ValueError:
            continue
        if lo - margin <= cand <= hi + margin:
            if best is None or abs(cand - ref) < abs(best - ref):
                best = cand
    return best


def _fuzzy_opening_row(transactions: list[Transaction]) -> Transaction | None:
    """Find the OPENING BALANCE pseudo-row among the first rows, tolerating
    OCR garbling ('OPENNG BALANCE')."""
    for t in transactions[:5]:
        desc = (t.description or "").lower()
        words = desc.split()
        for i in range(len(words) - 1):
            pair = f"{words[i]} {words[i + 1]}"
            if difflib.SequenceMatcher(None, pair, "opening balance").ratio() >= 0.7:
                return t
    return None


def _movement(t: Transaction) -> float:
    return (t.credit or 0.0) - (t.debit or 0.0)


def _one_sided(t: Transaction) -> bool:
    return (t.debit is None) != (t.credit is None)


def _flip(t: Transaction) -> None:
    t.debit, t.credit = t.credit, t.debit


def _mark(
    t: Transaction, conf: float, reason: str | None,
    review: bool = False, boost: bool = False,
) -> None:
    """boost=True raises confidence to `conf` (chain-confirmed row);
    otherwise caps it at `conf` (corrected/flagged row).

    Clearing a flag is NOT symmetric with setting one. Earlier stages flag rows
    for things the chain cannot speak to — an unreadable date
    (`_finalize_word_txn`), a date dropped as an outlier
    (`normalizer._drop_outlier_dates`). The chain only proves the ARITHMETIC, so
    confirming a segment must not silently un-flag a row whose date is missing;
    that would under-report the reading-confidence surface on exactly the
    statements that need it. We therefore only ever ADD a flag here, never
    withdraw one raised upstream — and the same asymmetry applies to the REASON
    string, which earlier stages also write without a flag (validator's "Amount
    inferred from balance delta"). Confirming a segment passes reason=None, so
    without the guard below it would wipe those notes clean.
    """
    t.confidence = round(
        max(t.confidence, conf) if boost else min(t.confidence, conf), 2
    )
    if review:
        t.needs_review = True
        t.review_reason = reason
    elif not t.needs_review and (reason is not None or t.review_reason is None):
        # Not flagged by anyone — safe to record the chain's own verdict
        # (usually None, i.e. "resolved"), but never to erase someone else's.
        t.review_reason = reason


def _solve_segment(
    rows: list[Transaction],
    prev_bal: float,
    seg_bal: float,
    corrections: list[str],
    allow_flag: bool = True,
    strict: bool = False,
    max_derive: float = float("inf"),
) -> float | None:
    """Reconcile the rows between two balance readings.

    `rows` are the transactions ending at (and including) the row that
    carries `seg_bal`. Returns the accepted segment-end balance (possibly
    repaired) on success, mutating rows in place. When nothing proves out:
    with allow_flag=True the segment is flagged and `seg_bal` accepted
    (terminal fallback); with allow_flag=False returns None untouched so
    the caller can defer — the segment-end balance itself may be the
    corrupt reading, and extending through the NEXT balance often resolves
    it (case: a 50.2M balance OCR'd as 90.2M drags the whole chain).
    """
    target = seg_bal - prev_bal
    s = sum(_movement(t) for t in rows)

    # (1) Already consistent — confirm every row.
    if abs(s - target) <= _TOL:
        for t in rows:
            if t.debit is not None or t.credit is not None:
                _mark(t, 0.9, None, boost=True)
        return seg_bal

    # (2) Direction flips of one-sided rows (single, then pairs).
    flippable = [t for t in rows if _one_sided(t)]
    if len(flippable) <= _MAX_FLIP_ROWS:
        for r in (1, 2):
            if r > len(flippable):
                break
            for combo in combinations(flippable, r):
                delta = sum(-2 * _movement(t) for t in combo)
                if abs((s + delta) - target) <= _TOL:
                    for t in combo:
                        _flip(t)
                        # review=True, matching validator.py's flip: a silent
                        # debit/credit swap that merely happens to satisfy the
                        # chain must not reach the user unseen. Both clients
                        # gate `review_reason` behind `needs_review`, so a
                        # reason recorded without the flag is serialised and
                        # then dropped on the floor — the money moved the other
                        # way and nothing said so.
                        _mark(t, 0.8, "Direction corrected by balance chain",
                              review=True)
                        corrections.append(
                            f"row {t.row_index}: flipped debit/credit (chain)"
                        )
                    return seg_bal

    def _amount_repair_candidates(prefix_only: bool) -> list[tuple[Transaction, float]]:
        """One-sided rows whose amount could absorb the residual.

        prefix_only=True keeps only the unambiguous signature — the read
        digits are a strict prefix of the corrected value ('2.228' read for
        a true 2,228,000: OCR box cut off trailing digits). The looser mode
        also allows single-digit substitutions.
        """
        residual = target - s
        found: list[tuple[Transaction, float]] = []
        for t in rows:
            if not _one_sided(t):
                continue
            amount = t.debit if t.debit is not None else t.credit
            signed = _movement(t)
            corrected = signed + residual
            # The corrected value must keep the row's direction.
            if (signed >= 0) != (corrected >= 0) and abs(corrected) > _TOL:
                continue
            new_amount = abs(corrected)

            def _digits(v: float) -> str:
                # Full-precision digits, no rounding ('2.228' must stay
                # '2228', not round to '2.23' -> '223').
                return (
                    f"{v:.10f}".rstrip("0").rstrip(".").replace(".", "").lstrip("0")
                )

            read_digits = _digits(amount)
            new_digits = _digits(new_amount)
            is_prefix = len(read_digits) >= 2 and new_digits.startswith(read_digits)
            if new_amount > max_derive:
                # A repair bigger than anything cleanly read on this
                # statement is more likely reconciling toward a corrupt
                # balance than recovering a real amount.
                continue
            if is_prefix or (
                not prefix_only and _digit_distance(amount, new_amount) <= 1
            ):
                found.append((t, new_amount))
        return found

    def _apply_amount_repair(t: Transaction, new_amount: float) -> None:
        old = t.debit if t.debit is not None else t.credit
        if t.debit is not None:
            t.debit = round(new_amount, 2)
        else:
            t.credit = round(new_amount, 2)
        # Reconstructed from the chain, so this row's balance gap is now zero
        # by construction — see Transaction.amount_inferred.
        t.amount_inferred = True
        _mark(t, 0.7, "Amount repaired from balance chain", boost=True)
        corrections.append(
            f"row {t.row_index}: amount {old:,.2f} -> {new_amount:,.2f} (chain)"
        )

    # Strict mode (deferred-anchor verification): only chain-exact evidence
    # counts — confirm, flips, or a single-digit repair of the segment-end
    # balance. Amount surgery (cases 3/4/4b) could "succeed" by fabricating
    # a movement, which must never be the proof that demotes a balance.
    if strict:
        expected = prev_bal + s
        if rows and (
            _digit_distance(expected, seg_bal) <= 1
            or _is_leading_digit_corruption(expected, seg_bal)
        ):
            corrections.append(
                f"row {rows[-1].row_index}: balance {seg_bal:,.2f} -> "
                f"{expected:,.2f} (digit OCR repair)"
            )
            rows[-1].balance = round(expected, 2)
            _mark(rows[-1], 0.7, "Balance repaired from chain")
            return expected
        return None

    # (3) Truncated-amount repair with the unambiguous digit-prefix
    # signature ('2.228' -> 2,228,000). Runs BEFORE empty-row filling: when
    # a truncated read explains the whole residual, dumping the residual
    # into an amount-less description fragment would fabricate a phantom
    # movement.
    prefix_candidates = _amount_repair_candidates(prefix_only=True)
    if len(prefix_candidates) == 1:
        _apply_amount_repair(*prefix_candidates[0])
        return seg_bal

    # (4) Exactly one row without any amount — fill it from the residual.
    empty = [t for t in rows if t.debit is None and t.credit is None]
    if len(empty) == 1:
        residual = target - s
        if abs(residual) > _TOL and abs(residual) <= max_derive:
            t = empty[0]
            if residual > 0:
                t.credit = round(residual, 2)
            else:
                t.debit = round(-residual, 2)
            t.amount_inferred = True
            _mark(t, 0.75, "Amount derived from balance chain", boost=True)
            corrections.append(
                f"row {t.row_index}: amount {abs(residual):,.2f} derived from chain"
            )
            return seg_bal

    # (4b) Looser single-row amount repair (single-digit substitutions).
    loose_candidates = _amount_repair_candidates(prefix_only=False)
    if len(loose_candidates) == 1:
        _apply_amount_repair(*loose_candidates[0])
        return seg_bal

    # (5) The segment-end balance itself may be the corrupt reading: when the
    # expected end balance is a digit-level OCR variant of the read one,
    # trust the movements (62.7M -> 52.7M, or 1,524,191.17 -> 91,524,191.17).
    expected = prev_bal + s
    if rows and (
        _digit_distance(expected, seg_bal) <= 1
        or _is_leading_digit_corruption(expected, seg_bal)
    ):
        corrections.append(
            f"row {rows[-1].row_index}: balance {seg_bal:,.2f} -> "
            f"{expected:,.2f} (digit OCR repair)"
        )
        rows[-1].balance = round(expected, 2)
        _mark(rows[-1], 0.7, "Balance repaired from chain")
        return expected

    # (6) Unresolved.
    if not allow_flag:
        return None
    for t in rows:
        _mark(t, 0.4, f"Chain mismatch: segment off by {target - s:,.2f}",
              review=True)
    corrections.append(
        f"rows {rows[0].row_index}-{rows[-1].row_index}: unresolved chain "
        f"mismatch {target - s:,.2f}"
    )
    return seg_bal


def solve_balance_chain(
    transactions: list[Transaction],
    opening_balance: float | None = None,
    *,
    lookahead: int = 3,
) -> ChainOutcome:
    """Reconcile an OCR'd transaction list against its running balance.

    Returns a ChainOutcome with the (mutated) transactions, a log of
    corrections, and the opening/closing balances established by the chain.

    The arithmetic tolerance is the module constant `_TOL`, shared by every
    comparison in here and matched to validator's. It is deliberately NOT a
    parameter: it used to be one, but nothing read it — the helpers all closed
    over `_TOL` — so a caller passing `tolerance=50.0` silently got 1.0.
    """
    out = ChainOutcome(transactions=transactions)
    if not transactions:
        return out

    # Drop the TRAILING summary/footer fragments the OCR word stream drags
    # in after the last real transaction ('RECEVED', a stray '0'): rows with
    # neither a date nor any movement. Their garbled balances would
    # otherwise anchor the chain and become the closing balance. Only the
    # trailing run is removed — a mid-document row with a balance but no
    # readable date/amount is real and the walk below can still derive it.
    dropped = 0
    while transactions:
        last = transactions[-1]
        if last.txn_date is None and last.debit is None and last.credit is None:
            transactions.pop()
            dropped += 1
        else:
            break
    if dropped:
        out.corrections.append(
            f"dropped {dropped} trailing summary/footer fragment row(s)"
        )
    if not transactions:
        return out

    # --- Opening anchor ---
    opening = opening_balance
    open_row = _fuzzy_opening_row(transactions)
    if open_row is not None and open_row.balance is not None:
        if opening is None:
            opening = open_row.balance
        # The pseudo-row itself is not a transaction: drop it when it is
        # chain-neutral (no movement); its description is scanner noise.
        if open_row.debit is None and open_row.credit is None:
            transactions.remove(open_row)
            out.corrections.append(
                f"removed OPENING BALANCE pseudo-row (balance {open_row.balance:,.2f})"
            )
    if opening is None:
        # Back-derive from the first row that has both balance and movement.
        first = next(
            (t for t in transactions
             if t.balance is not None and (t.debit is not None or t.credit is not None)),
            None,
        )
        if first is not None:
            opening = round(first.balance - _movement(first), 2)
            out.corrections.append(f"opening balance inferred: {opening:,.2f}")
    out.opening_balance = opening
    if opening is None or not transactions:
        out.closing_balance = next(
            (t.balance for t in reversed(transactions) if t.balance is not None),
            None,
        )
        return out

    # Derivation cap: never derive/repair an amount wildly beyond the
    # largest amount the OCR actually READ on this statement — a giant
    # residual is a corrupt anchor, not a real movement.
    parsed_amounts = [
        a for t in transactions for a in (t.debit, t.credit) if a
    ]
    max_derive = max(
        1.5 * (max(parsed_amounts) if parsed_amounts else 0.0), 5_000_000.0
    )

    # --- Pre-pass: demote balance SPIKES ---
    # A reading that deviates hugely from BOTH neighbors while the
    # neighbors agree with each other is an OCR leading-digit swap
    # (30.9M sitting between 90.2M and 90.7M), not a real movement — a
    # genuine jump (a 36M deposit) persists in the following readings.
    # Iterate until stable: demoting one corrupt reading exposes the next
    # (in densely-corrupted stretches the first pass's "neighbors" are
    # themselves fakes).
    for _ in range(5):
        balance_rows = [t for t in transactions if t.balance is not None]
        original = [t.balance for t in balance_rows]  # judge pre-demotion values
        demoted_any = False
        for j in range(1, len(balance_rows) - 1):
            prev_b, b, next_b = original[j - 1], original[j], original[j + 1]
            neighbor_gap = abs(next_b - prev_b)
            deviation = min(abs(b - prev_b), abs(b - next_b))
            # A leading-digit OCR swap moves the value by a large FRACTION of
            # its magnitude (90M read for 50M). Genuine transactions produce
            # V-shapes of a few percent — never demote those.
            if (
                deviation > max(1_000_000.0, 3 * neighbor_gap)
                and deviation > 0.25 * max(abs(b), abs(prev_b))
            ):
                row = balance_rows[j]
                # Prefer REPAIR over demotion: a spike is usually leading
                # digits lost or misread ('1,524,191.17' for 91,524,191.17).
                # Reconstruct from a neighbour's leading digits and keep it
                # only if the result lands between the neighbours.
                fixed = _repair_from_neighbour(b, prev_b, next_b)
                if fixed is not None:
                    out.corrections.append(
                        f"row {row.row_index}: balance {b:,.2f} -> {fixed:,.2f} "
                        f"(leading-digit repair)"
                    )
                    row.balance = fixed
                    _mark(row, 0.7, "Balance leading digits repaired")
                else:
                    out.corrections.append(
                        f"row {row.row_index}: balance {b:,.2f} demoted (spike between "
                        f"{prev_b:,.2f} and {next_b:,.2f})"
                    )
                    row.balance = None
                    _mark(row, 0.6, "Balance reading was an OCR spike — ignored")
                demoted_any = True
        if not demoted_any:
            break

    # --- Segment walk with deferred anchoring ---
    # A segment that won't reconcile may simply END on a corrupt balance
    # reading (leading-digit OCR swaps like 5->9 produce 90.2M for 50.2M).
    # Instead of anchoring the chain on it, defer: demote that balance to a
    # suspect and try again with the segment extended through the next
    # balance. Only after `lookahead` consecutive suspects do we give up
    # and flag the whole stretch.
    prev = opening
    segment: list[Transaction] = []
    suspects: list[Transaction] = []
    for t in transactions:
        segment.append(t)
        if t.balance is None:
            continue
        deferred = bool(suspects)
        solved = _solve_segment(
            segment, prev, t.balance, out.corrections,
            allow_flag=False, strict=deferred, max_derive=max_derive,
        )
        if solved is None:
            raw_mismatch = abs(
                (t.balance - prev) - sum(_movement(r) for r in segment)
            )
            if not deferred and raw_mismatch < _DEFER_MIN:
                # Small residue — a misread amount somewhere, not a corrupt
                # balance. Flag honestly, keep the anchor.
                solved = _solve_segment(
                    segment, prev, t.balance, out.corrections,
                    allow_flag=True, max_derive=max_derive,
                )
            elif len(suspects) >= lookahead:
                # Give up on this stretch: flag it (no amount fabrication)
                # and re-anchor on the current reading.
                solved = _solve_segment(
                    segment, prev, t.balance, out.corrections,
                    allow_flag=True, strict=False, max_derive=max_derive,
                )
            else:
                # Large mismatch — the segment-end balance itself is the
                # prime suspect. Defer anchoring and extend the segment.
                suspects.append(t)
                continue
            suspects = []
            prev = solved
            segment = []
            continue
        if deferred:
            # The extended segment reconciled STRICTLY (movements as read /
            # flipped bridge prev -> this balance) — the deferred balances
            # were the corrupt readings.
            for s_row in suspects:
                bad = s_row.balance
                s_row.balance = None
                _mark(s_row, 0.6, "Balance reading contradicted the chain — ignored")
                out.corrections.append(
                    f"row {s_row.row_index}: balance {bad:,.2f} demoted (chain outlier)"
                )
        suspects = []
        prev = solved
        segment = []

    # A trailing run of suspects that never resolved: flag it honestly.
    #
    # Only the rows UP TO AND INCLUDING the last suspect may be reconciled
    # against that suspect's balance — `_solve_segment` documents exactly that
    # precondition. The walk keeps extending `segment` after a deferral, so it
    # can hold balance-less rows that come AFTER the last suspect; handing the
    # whole thing over compares their movements against a balance recorded
    # before they happened, which cannot reconcile and flags the entire stretch
    # as a mismatch. Worse, clearing `segment` afterwards dropped those rows'
    # movements from the closing balance entirely. Split instead, and let the
    # trailing-rows loop below carry the remainder forward.
    if suspects and segment:
        anchor = suspects[-1]
        cut = next(
            (i for i, r in enumerate(segment) if r is anchor), len(segment) - 1
        ) + 1
        prev = _solve_segment(
            segment[:cut], prev, anchor.balance, out.corrections,
            allow_flag=True, max_derive=max_derive,
        )
        segment = segment[cut:]

    # Trailing rows after the last balance reading: derive their balances
    # forward from the last anchor so the closing balance reflects them.
    closing = prev
    for t in segment:
        if t.debit is not None or t.credit is not None:
            closing = round(closing + _movement(t), 2)
    out.closing_balance = closing

    # Final sweep: rows that STILL carry no movement after the walk had its
    # chance to derive one, and no date either, are OCR line fragments — a
    # wrapped description or a header echo that got split into its own row.
    # They would show up in the ledger as dateless zero-value entries.
    # (Rows with a date are kept and stay flagged: they are real
    # transactions whose amount we could not recover, and hiding those
    # would be worse than showing them for review.)
    fragments = [
        t for t in transactions
        if t.debit is None and t.credit is None and t.txn_date is None
    ]
    for t in fragments:
        transactions.remove(t)
    if fragments:
        out.corrections.append(
            f"dropped {len(fragments)} dateless line-fragment row(s) with no movement"
        )

    if out.corrections:
        log.info("Chain solver: %d corrections", len(out.corrections))
        for c in out.corrections[:20]:
            log.info("  %s", c)
    return out

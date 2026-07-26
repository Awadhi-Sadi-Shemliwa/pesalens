"""
Validator: checks arithmetic consistency of extracted transactions.

Validations:
1. Running balance: prev_balance + credit - debit = new_balance
2. No negative balances (unless overdraft)
3. Date ordering: transactions should be chronological
4. Flag suspicious amounts (too large, too small)
"""

from app.schemas.transaction import Transaction
from app.utils.logger import get_logger

log = get_logger(__name__)

# Maximum single transaction amount (TZS) before flagging
MAX_AMOUNT_TZS = 500_000_000  # 500 million TZS
BALANCE_TOLERANCE = 1.0  # Allow 1 TZS rounding difference


def _validate_non_chain_checks(
    transactions: list[Transaction], errors: list[str],
) -> tuple[list[Transaction], list[str]]:
    """Date-ordering + suspicious-amount checks only.

    Used for chain-solved (scanned) documents, where the balance-chain
    verdict already belongs to chain_solver.
    """
    prev_date = None
    for txn in transactions:
        if txn.txn_date is not None:
            if prev_date is not None and txn.txn_date < prev_date:
                msg = (
                    f"Row {txn.row_index}: date out of order "
                    f"({txn.txn_date} < {prev_date})"
                )
                errors.append(msg)
                txn.needs_review = True
                txn.review_reason = txn.review_reason or "Date out of order"
            prev_date = txn.txn_date

    for txn in transactions:
        for label, amount in [("debit", txn.debit), ("credit", txn.credit)]:
            if amount is not None and amount > MAX_AMOUNT_TZS:
                msg = f"Row {txn.row_index}: unusually large {label}: {amount:,.2f}"
                errors.append(msg)
                txn.needs_review = True
                txn.review_reason = txn.review_reason or f"Large {label}"

    review_count = sum(1 for t in transactions if t.needs_review)
    log.info(
        "Validation (chain-solved): %d errors, %d rows need review out of %d",
        len(errors), review_count, len(transactions),
    )
    return transactions, errors


def _infer_opening_balance(transactions: list[Transaction]) -> float | None:
    """
    Back-derive the opening balance from the FIRST transaction if it has
    both a known balance AND a known debit/credit.

    opening = row1.balance - row1.credit + row1.debit
    """
    if not transactions:
        return None
    txn = transactions[0]
    if txn.balance is None:
        return None
    if txn.debit is None and txn.credit is None:
        return None
    debit = txn.debit or 0.0
    credit = txn.credit or 0.0
    return round(txn.balance - credit + debit, 2)


def validate_transactions(
    transactions: list[Transaction],
    opening_balance: float | None = None,
    chain_already_solved: bool = False,
) -> tuple[list[Transaction], list[str]]:
    """
    Validate a list of transactions for consistency.

    `chain_already_solved=True` (scanned documents that went through
    chain_solver) skips every balance-chain repair and check below: the
    solver is authoritative there, having already reconciled amounts,
    directions and OCR-corrupt balances with full-document lookahead.
    Re-running these simpler heuristics on its output would second-guess
    proven corrections — and would re-derive amounts from the very balance
    readings the solver demoted as corrupt. Date-ordering and
    suspicious-amount checks still run.

    Returns:
        Tuple of (validated_transactions, validation_errors)
    """
    errors: list[str] = []

    if not transactions:
        return transactions, ["No transactions to validate"]

    if chain_already_solved:
        return _validate_non_chain_checks(transactions, errors)

    # --- 0. Repair missing debit/credit from balance delta ---
    # pdfplumber occasionally drops the amount cell when debit/credit columns
    # are narrow or sparsely populated, leaving the row with only a balance.
    # If we know the previous balance, the delta tells us exactly what the
    # missing amount was (positive delta = credit, negative delta = debit).
    #
    # When opening_balance is unknown but the FIRST row lacks debit/credit
    # while later rows carry known amounts, we can back-derive the opening
    # balance from the first fully-known row and then repair row 1.
    if opening_balance is None:
        inferred = _infer_opening_balance(transactions)
        if inferred is not None:
            opening_balance = inferred
            log.info("Inferred opening balance: %.2f", inferred)

    prev_balance = opening_balance
    for txn in transactions:
        if (
            txn.balance is not None
            and prev_balance is not None
            and txn.debit is None
            and txn.credit is None
        ):
            delta = txn.balance - prev_balance
            if abs(delta) > BALANCE_TOLERANCE:
                if delta > 0:
                    txn.credit = round(delta, 2)
                else:
                    txn.debit = round(-delta, 2)
                txn.review_reason = "Amount inferred from balance delta"
                # The delta is the WHOLE movement, so any bank charge bundled
                # into it is now indistinguishable from the transaction amount.
                # Tagging the row lets the charges detector report that blind
                # spot instead of silently under-counting fees.
                txn.amount_inferred = True
                txn.confidence = min(txn.confidence, 0.75)
                log.info(
                    "Row %d: inferred %s=%.2f from balance delta",
                    txn.row_index,
                    "credit" if delta > 0 else "debit",
                    abs(delta),
                )
        if txn.balance is not None:
            prev_balance = txn.balance

    # --- 0.5 Repair flipped debit/credit from balance delta ---
    # OCR word-position extraction can drop a right-aligned amount into the
    # neighbouring column (a withdrawal read as a credit). The balance chain
    # is ground truth: when the recorded direction contradicts the chain but
    # the FLIPPED direction satisfies it exactly, flip. Only rows with a
    # known previous balance, their own balance, and exactly one of
    # debit/credit qualify — the flip is proven, not guessed.
    prev_balance = opening_balance
    for txn in transactions:
        if txn.balance is not None and prev_balance is not None:
            debit = txn.debit or 0.0
            credit = txn.credit or 0.0
            one_sided = (txn.debit is None) != (txn.credit is None)
            as_is = abs((prev_balance - debit + credit) - txn.balance)
            flipped = abs((prev_balance - credit + debit) - txn.balance)
            if one_sided and as_is > BALANCE_TOLERANCE and flipped <= BALANCE_TOLERANCE:
                txn.debit, txn.credit = txn.credit, txn.debit
                # Flag the row so the review surface actually shows the
                # mutation: a silent debit/credit swap that merely happens to
                # satisfy the chain must not reach the user unseen. Preserve any
                # reason already set (e.g. §0's balance-delta inference) instead
                # of clobbering it.
                txn.needs_review = True
                flip_reason = "Direction flipped to satisfy balance chain"
                txn.review_reason = (
                    f"{txn.review_reason}; {flip_reason}"
                    if txn.review_reason
                    else flip_reason
                )
                txn.confidence = min(txn.confidence, 0.8)
                log.info(
                    "Row %d: flipped debit/credit to match balance chain",
                    txn.row_index,
                )
        if txn.balance is not None:
            prev_balance = txn.balance

    # --- 1. Balance chain validation ---
    prev_balance = opening_balance
    for txn in transactions:
        if txn.balance is not None and prev_balance is not None:
            debit = txn.debit or 0.0
            credit = txn.credit or 0.0
            expected = prev_balance - debit + credit

            diff = abs(expected - txn.balance)
            if diff > BALANCE_TOLERANCE:
                msg = (
                    f"Row {txn.row_index}: balance mismatch. "
                    f"Expected {expected:.2f}, got {txn.balance:.2f} "
                    f"(diff={diff:.2f})"
                )
                errors.append(msg)
                txn.needs_review = True
                txn.review_reason = f"Balance mismatch: diff={diff:.2f}"
                txn.confidence = min(txn.confidence, 0.5)
                log.warning(msg)

        if txn.balance is not None:
            prev_balance = txn.balance

    # --- 2. Date ordering ---
    prev_date = None
    for txn in transactions:
        if txn.txn_date is not None:
            if prev_date is not None and txn.txn_date < prev_date:
                msg = f"Row {txn.row_index}: date out of order ({txn.txn_date} < {prev_date})"
                errors.append(msg)
                txn.needs_review = True
                txn.review_reason = txn.review_reason or "Date out of order"
            prev_date = txn.txn_date

    # --- 3. Suspicious amounts ---
    for txn in transactions:
        for label, amount in [("debit", txn.debit), ("credit", txn.credit)]:
            if amount is not None and amount > MAX_AMOUNT_TZS:
                msg = f"Row {txn.row_index}: unusually large {label}: {amount:,.2f}"
                errors.append(msg)
                txn.needs_review = True
                txn.review_reason = txn.review_reason or f"Large {label}"

    # --- Summary ---
    review_count = sum(1 for t in transactions if t.needs_review)
    if errors:
        log.warning(
            "Validation: %d errors, %d rows need review out of %d",
            len(errors),
            review_count,
            len(transactions),
        )
    else:
        log.info("Validation passed: %d transactions OK", len(transactions))

    return transactions, errors

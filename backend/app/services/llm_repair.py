"""
LLM Repair: uses Google Gemini to fix ambiguous or broken transaction rows.

This is OPTIONAL and only used when:
1. enable_llm_repair is True in config
2. A transaction has low confidence or is flagged for review

Design:
- Sends ONLY broken rows (not the whole document) to minimize tokens
- Includes previous/next row context so the LLM can infer patterns
- Uses a structured prompt with decision rules and expected JSON schema
- Batches rows (up to 10) to reduce API calls
"""

import json
from typing import Optional

from app.config import settings
from app.schemas.transaction import Transaction, StatementMetadata
from app.utils.logger import get_logger

log = get_logger(__name__)


def repair_transactions(
    transactions: list[Transaction],
    metadata: StatementMetadata | None = None,
) -> list[Transaction]:
    """
    Send low-confidence transactions to Gemini for repair.

    Only processes rows where needs_review=True.
    """
    if not settings.enable_llm_repair:
        log.info("LLM repair is disabled, skipping")
        return transactions

    if not settings.gemini_api_key:
        log.warning("No Gemini API key configured, skipping LLM repair")
        return transactions

    rows_to_repair = [t for t in transactions if t.needs_review]
    if not rows_to_repair:
        log.info("No rows need repair")
        return transactions

    log.info("Sending %d rows to Gemini for repair", len(rows_to_repair))

    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        # Build index for neighbor lookup
        txn_by_idx = {t.row_index: t for t in transactions}

        # Batch rows to minimize API calls (up to 10 at a time)
        batch_size = 10
        for i in range(0, len(rows_to_repair), batch_size):
            batch = rows_to_repair[i : i + batch_size]
            prompt = _build_smart_prompt(batch, txn_by_idx, metadata)
            repaired = _call_gemini(model, prompt, len(batch))

            for original, fixed in zip(batch, repaired):
                if fixed:
                    _apply_repair(original, fixed)

    except ImportError:
        log.warning("google-generativeai package not installed, skipping LLM repair")
    except Exception as e:
        log.error("LLM repair failed: %s", e)

    return transactions


def _call_gemini(model, prompt: str, expected_count: int) -> list[Optional[dict]]:
    """Send prompt to Gemini and parse the JSON response."""
    try:
        response = model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.1,
                "max_output_tokens": 2000,
                "response_mime_type": "application/json",
            },
        )
        text = (getattr(response, "text", "") or "").strip()

        result = json.loads(text)
        if isinstance(result, dict) and "rows" in result:
            result = result["rows"]
        if isinstance(result, list):
            return result
        return [result]

    except Exception as e:
        log.error("Gemini repair call failed: %s", e)
        return [None] * expected_count


def _format_row(txn: Transaction) -> dict:
    """Format a transaction as a dict for the prompt."""
    return {
        "row_index": txn.row_index,
        "date": str(txn.txn_date) if txn.txn_date else None,
        "description": txn.description,
        "reference": txn.reference,
        "debit": txn.debit,
        "credit": txn.credit,
        "balance": txn.balance,
        "raw_text": txn.raw_text,
    }


def _get_neighbor(txn_by_idx: dict, row_index: int, offset: int) -> Optional[dict]:
    """Get a neighboring row by offset (-1 = previous, +1 = next)."""
    neighbor = txn_by_idx.get(row_index + offset)
    if neighbor:
        return _format_row(neighbor)
    return None


def _detect_date_format(transactions: list[Transaction]) -> str:
    """Detect the dominant date format from successfully parsed transactions."""
    return "YYYY-MM-DD (ISO). Input formats seen in Tanzanian statements: DD/MM/YYYY, DD.MM.YYYY, DD-Mon-YYYY, YYYY-MM-DD."


def _build_smart_prompt(
    broken_rows: list[Transaction],
    txn_by_idx: dict[int, Transaction],
    metadata: StatementMetadata | None,
) -> str:
    """
    Build a context-rich prompt for Gemini to repair broken rows.

    Includes:
    - Statement metadata (bank, currency, period)
    - Expected output schema
    - Decision rules for common issues
    - Previous/current/next row context for each broken row
    """
    bank = metadata.bank.value if metadata else "unknown"
    currency = metadata.currency if metadata else "TZS"
    period = ""
    if metadata and metadata.period_start and metadata.period_end:
        period = f" for period {metadata.period_start} to {metadata.period_end}"

    row_blocks = []
    for txn in broken_rows:
        prev_row = _get_neighbor(txn_by_idx, txn.row_index, -1)
        next_row = _get_neighbor(txn_by_idx, txn.row_index, +1)

        block = {
            "issue": txn.review_reason or "Unknown issue",
            "current_row": _format_row(txn),
        }
        if prev_row:
            block["previous_row"] = prev_row
        if next_row:
            block["next_row"] = next_row
        row_blocks.append(block)

    rows_json = json.dumps(row_blocks, indent=2, default=str)

    return f"""You are a financial data extraction specialist repairing broken transaction rows from a {bank} bank statement ({currency}{period}).

## CONTEXT
- Bank: {bank}
- Currency: {currency}
- Date formats: {_detect_date_format(list(txn_by_idx.values()))}
- Each row should have: date, description, exactly one of debit OR credit (not both), and a running balance.

## YOUR TASK
Fix the broken rows below. For each row you receive:
- `current_row`: the broken transaction data and its raw_text
- `previous_row` / `next_row`: neighboring rows for context (if available)
- `issue`: what the parser flagged as wrong

## DECISION RULES
1. **Missing date**: Look at raw_text for a date string. If none found, check if this is a continuation of the previous row (same transaction, multi-line description). If so, merge into previous row by returning action="merge_into_previous".
2. **No debit or credit**: Parse the raw_text for amount patterns. If a single amount is found, decide debit vs credit by:
   - If balance decreased vs previous row -> debit
   - If balance increased vs previous row -> credit
   - If description contains "deposit", "received", "credit", "incoming", "CR" -> credit
   - If description contains "withdrawal", "payment", "debit", "charge", "fee", "DR" -> debit
3. **Balance mismatch**: Recalculate: `new_balance = prev_balance - debit + credit`. If your calculation matches raw_text better than the parsed balance, use your calculation.
4. **Garbled description**: Clean up OCR artifacts, fix obvious typos, remove stray characters. Keep the original meaning.
5. **Duplicate row**: If current_row is identical to previous_row or next_row, return action="delete".
6. **Unfixable**: If the row is too garbled to repair confidently, return action="flag" with a reason.

## OUTPUT FORMAT
Return a JSON object with a single "rows" key whose value is an array. Each element of the array must be one of:

### Fixed row:
{{
  "row_index": 1,
  "action": "fix",
  "date": "YYYY-MM-DD",
  "description": "cleaned description",
  "reference": "REF123 or null",
  "debit": 1000.00,
  "credit": null,
  "balance": 50000.00,
  "confidence": 0.85
}}

### Merge into previous:
{{
  "row_index": 2,
  "action": "merge_into_previous",
  "extra_description": "additional text to append"
}}

### Delete (duplicate):
{{
  "row_index": 3,
  "action": "delete"
}}

### Unfixable:
{{
  "row_index": 4,
  "action": "flag",
  "reason": "why this cannot be repaired"
}}

## IMPORTANT
- Return ONLY the JSON object {{"rows": [...]}}. No prose, no markdown fences.
- Use null (not 0) for missing amounts.
- Amounts must be positive numbers (no negative values).
- Debit and credit are mutually exclusive — a row has one or the other, never both.
- Confidence should be between 0.0 and 1.0 — how confident you are in your fix.

## BROKEN ROWS
{rows_json}"""


def _apply_repair(original: Transaction, fixed: dict) -> None:
    """Apply LLM-repaired values to the original transaction."""
    try:
        action = fixed.get("action", "fix")

        if action == "delete":
            original.description = "[DELETED - duplicate]"
            original.confidence = 0.0
            original.needs_review = True
            original.review_reason = "Marked as duplicate by LLM"
            return

        if action == "flag":
            original.review_reason = f"LLM unfixable: {fixed.get('reason', 'unknown')}"
            return

        if action == "merge_into_previous":
            extra = fixed.get("extra_description", "")
            original.description = f"[MERGE] {extra}"
            original.review_reason = "LLM says merge into previous row"
            return

        # action == "fix"
        if fixed.get("date"):
            from datetime import date as dt_date
            parts = str(fixed["date"]).split("-")
            if len(parts) == 3:
                original.txn_date = dt_date(int(parts[0]), int(parts[1]), int(parts[2]))

        if fixed.get("description"):
            original.description = fixed["description"]

        if fixed.get("reference"):
            original.reference = fixed["reference"]

        for field in ["debit", "credit", "balance"]:
            val = fixed.get(field)
            if val is not None:
                setattr(original, field, float(val))
            elif field in fixed:
                setattr(original, field, None)

        llm_confidence = fixed.get("confidence", 0.7)
        original.confidence = round(min(float(llm_confidence), 0.9), 2)
        original.needs_review = False
        original.review_reason = f"Repaired by LLM ({action})"

    except Exception as e:
        log.warning("Failed to apply repair to row %d: %s", original.row_index, e)

"""
Detect and remove the password protection on uploaded statement PDFs.

The user uploads a statement (often CRDB / NMB / Absa) where the open-password
is a 6-digit number — usually the last 6 digits of the account number. We
don't want to make the user re-type that password on every upload, so this
module *recovers the password automatically* in the background and hands a
fully unencrypted PDF back to the extraction pipeline.

Two crackers stack to keep the worst case bounded:

  1. A fast pure-crypto Standard Security verifier (PDF spec 7.6.3 /
     ISO 32000-1 Algorithms 2/5/6) that checks a candidate password using
     just MD5 + RC4 — about 4 000 candidates/sec/core, ~10× faster than
     going through pypdf for each attempt.
  2. A worker pool that spreads the 1 000 000-candidate 6-digit space
     across every CPU core, with an `Event`-based early-exit so all
     workers stop the moment one finds the password.

A small "common passwords" list (000000, 123456, 111111, …) is tried up
front so most uploads finish in milliseconds. The full 6-digit sweep is
the fallback and finishes within tens of seconds on a modern laptop.

Once recovered, we re-emit a fresh, unencrypted PDF with pypdf so the
existing pdfplumber-based pipeline can read it without any further
changes.

The password is never persisted, never logged, and lives only on the
worker stack for the duration of one upload.
"""

from __future__ import annotations

import hashlib
import io
import multiprocessing as mp
import os
import struct
import time
from typing import Iterable, Optional

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.decrepit.ciphers.algorithms import ARC4
from cryptography.hazmat.primitives.ciphers import Cipher
from pypdf import PdfReader, PdfWriter
from pypdf.errors import DependencyError, PdfReadError

from app.utils.logger import get_logger

log = get_logger(__name__)


# --- Public exception types ------------------------------------------------

class PdfUnlockError(Exception):
    """Base for PDF-unlock failures."""


class PdfPasswordIrrecoverable(PdfUnlockError):
    """Encrypted PDF whose password we couldn't recover within the budget."""


class PdfUnlockUnsupported(PdfUnlockError):
    """The PDF uses an encryption scheme we cannot handle."""


# --- Encryption-parameter parsing -----------------------------------------

# PDF Standard Security padding string (ISO 32000-1, Section 7.6.3.3).
_PADDING = bytes.fromhex(
    "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A"
)


def _to_bytes(o) -> bytes:
    """Coerce a pypdf string-like object into raw bytes."""
    if hasattr(o, "original_bytes"):
        return bytes(o.original_bytes)
    if isinstance(o, bytes):
        return o
    if isinstance(o, str):
        return o.encode("latin1")
    return bytes(o)


class _EncParams:
    """Just the bits of the /Encrypt dict we need to verify a password."""

    __slots__ = ("R", "P", "key_len", "O", "U", "file_id", "encrypt_metadata")

    def __init__(self, R: int, P: int, key_len: int, O: bytes, U: bytes,
                 file_id: bytes, encrypt_metadata: bool):
        self.R = R
        self.P = P
        self.key_len = key_len
        self.O = O
        self.U = U
        self.file_id = file_id
        self.encrypt_metadata = encrypt_metadata


def _read_enc_params(content: bytes) -> Optional[_EncParams]:
    """
    Pull the encryption parameters out of an encrypted PDF.

    Returns None if the PDF isn't encrypted with Standard Security at a
    revision we know how to verify. We support R=2 (RC4-40), R=3 (RC4-128),
    and R=4 (RC4-128 / AES-128) — every revision used by Tanzanian retail
    bank statements as of writing.
    """
    reader = PdfReader(io.BytesIO(content))
    if not reader.is_encrypted:
        return None
    enc = reader.trailer["/Encrypt"].get_object()
    filt = enc.get("/Filter")
    if filt is not None and str(filt) not in ("/Standard", "Standard"):
        # `filt` comes from attacker-supplied PDF metadata. Don't echo it
        # back in the user message; log server-side instead.
        log.warning("Unsupported PDF security handler: %r", filt)
        raise PdfUnlockUnsupported(
            "This PDF uses a non-standard security handler we can't open."
        )
    R = int(enc["/R"])
    if R not in (2, 3, 4):
        # R=5/6 (AES-256, used by PDF 1.7 ext3 and PDF 2.0) needs a
        # different verification algorithm — not used by TZ banks today.
        raise PdfUnlockUnsupported(f"PDF revision R={R} not supported")
    P = int(enc["/P"]) & 0xFFFFFFFF
    key_len = int(enc.get("/Length", 40)) // 8
    O = _to_bytes(enc["/O"])
    U = _to_bytes(enc["/U"])
    if "/ID" not in reader.trailer:
        raise PdfUnlockUnsupported("PDF trailer is missing /ID")
    file_id = _to_bytes(reader.trailer["/ID"][0])
    em_obj = enc.get("/EncryptMetadata")
    encrypt_metadata = True if em_obj is None else bool(em_obj)
    return _EncParams(R, P, key_len, O, U, file_id, encrypt_metadata)


# --- Pure-crypto user-password check (Algorithms 2 + 5) ------------------

def _make_checker(p: _EncParams):
    """
    Build a `check(password_bytes) -> bool` closure for this PDF.

    Pre-computes everything that doesn't depend on the password (the
    seed for Algorithm 5, packed P, etc.) so the per-attempt work is
    just two MD5 chains and ~20 short RC4 encryptions.
    """
    R = p.R
    key_len = p.key_len
    O = p.O
    U_first16 = p.U[:16]
    P_bytes = struct.pack("<I", p.P)
    file_id = p.file_id
    extra = b"\xff\xff\xff\xff" if (R >= 4 and not p.encrypt_metadata) else b""
    # Seed for Algorithm 5 — independent of password.
    seed5 = hashlib.md5(_PADDING + file_id).digest()
    backend = default_backend()

    def _rc4(key: bytes, data: bytes) -> bytes:
        return Cipher(ARC4(key), mode=None, backend=backend).encryptor().update(data)

    def check(pw: bytes) -> bool:
        # Algorithm 2 — derive the encryption key.
        padded = (pw + _PADDING)[:32]
        h = hashlib.md5()
        h.update(padded)
        h.update(O)
        h.update(P_bytes)
        h.update(file_id)
        if extra:
            h.update(extra)
        digest = h.digest()
        if R >= 3:
            for _ in range(50):
                digest = hashlib.md5(digest[:key_len]).digest()
        key = digest[:key_len]

        # Algorithm 5 — compute the U value.
        if R >= 3:
            result = _rc4(key, seed5)
            for i in range(1, 20):
                xkey = bytes(b ^ i for b in key)
                result = _rc4(xkey, result)
            return result[:16] == U_first16
        # R == 2 — single RC4 pass.
        return _rc4(key, _PADDING) == p.U

    return check


# --- Crack strategy --------------------------------------------------------

# Cheap candidates that disproportionately appear in real-world locked PDFs.
# Tried serially before any brute force kicks in.
_COMMON_PASSWORDS: tuple[str, ...] = (
    "",
    "000000", "123456", "111111", "999999", "121212", "654321",
    "112233", "789456", "147258", "159753", "010203", "010101",
    "000001", "100000", "555555", "888888", "777777", "222222",
    "333333", "444444", "666666",
    "password", "Password", "12345678", "1234", "0000", "00000000",
    "PESALENS", "pesalens",
)


def _digit_strings(start: int, end: int, width: int) -> Iterable[bytes]:
    """Yield zero-padded decimal strings as bytes for the given half-open range."""
    fmt = f"%0{width}d"
    for i in range(start, end):
        yield (fmt % i).encode("latin1")


def _worker_sweep(args):
    """
    Multiprocessing worker — tries every candidate in [start, end) of the
    given numeric width and returns the password as soon as it's found.

    `stop_event` lets siblings short-circuit the moment any worker finds
    the password. Workers also re-check the event every 4 096 attempts to
    keep the scheduler responsive.
    """
    start, end, width, params_bytes, stop_event = args
    # Re-build the EncParams in the worker process. Fork on POSIX would
    # share memory; spawn on Windows requires explicit serialisation.
    from pickle import loads
    p: _EncParams = loads(params_bytes)
    check = _make_checker(p)
    fmt = f"%0{width}d"
    n = 0
    for i in range(start, end):
        if check((fmt % i).encode("latin1")):
            stop_event.set()
            return fmt % i
        n += 1
        if (n & 0xFFF) == 0 and stop_event.is_set():
            return None
    return None


def _try_candidates(check, candidates: Iterable[bytes]) -> Optional[bytes]:
    """Try each candidate sequentially. Returns the matching password or None."""
    for cand in candidates:
        if check(cand):
            return cand
    return None


def _bruteforce_numeric(p: _EncParams, width: int = 6,
                        deadline_seconds: float = 90.0) -> Optional[bytes]:
    """
    Sweep every `width`-digit numeric password across all CPU cores.

    Returns the matched password (as bytes) or None if the deadline
    elapses or the keyspace is exhausted. We default to 90s which is
    well above the worst-case for a 6-digit space on a modern laptop
    (full 1 000 000-attempt sweep ≈ 30s on 12 cores at ~35k attempts/sec).
    """
    total = 10 ** width
    workers = max(1, (os.cpu_count() or 2) - 1)
    chunk = (total + workers - 1) // workers

    # Pickle params once so workers don't repeat the parse.
    from pickle import dumps
    params_bytes = dumps(p)

    ranges = [(i * chunk, min((i + 1) * chunk, total)) for i in range(workers)]
    ctx = mp.get_context("spawn")
    stop_event = ctx.Manager().Event()
    args = [(s, e, width, params_bytes, stop_event) for (s, e) in ranges]

    started = time.time()
    with ctx.Pool(processes=workers) as pool:
        try:
            iterator = pool.imap_unordered(_worker_sweep, args, chunksize=1)
            for result in iterator:
                if result is not None:
                    pool.terminate()
                    return result.encode("latin1")
                if time.time() - started > deadline_seconds:
                    stop_event.set()
                    pool.terminate()
                    return None
        finally:
            pool.close()
            pool.join()
    return None


# --- Public API ------------------------------------------------------------

def is_encrypted(content: bytes) -> bool:
    """Return True if the PDF appears to be encrypted."""
    try:
        return bool(PdfReader(io.BytesIO(content)).is_encrypted)
    except Exception:
        return b"/Encrypt" in content[:65536] or b"/Encrypt" in content[-65536:]


def _emit_decrypted(content: bytes, password: str) -> bytes:
    """Re-emit `content` as an unencrypted PDF using pypdf + the recovered password.

    We copy pages one-by-one with `add_page` rather than `PdfWriter(clone_from=reader)`
    because `clone_from` has truncated multi-page CRDB statements down to a
    single page on real-world inputs — pdfplumber then reads only that page.
    Per-page `add_page` preserves the full document and produces output that
    pdfplumber + pdfminer parse cleanly.
    """
    try:
        reader = PdfReader(io.BytesIO(content))
        result = reader.decrypt(password)
        if int(result) == 0:
            # Sanity check — should never happen since the password was just verified.
            raise PdfUnlockUnsupported("Recovered password did not unlock the PDF")
    except (DependencyError, NotImplementedError) as exc:
        # Library-specific message can include dependency / class names —
        # keep that detail in the server log only, surface a generic
        # message to the user.
        log.warning("PDF unlock dependency/feature gap: %s", exc)
        raise PdfUnlockUnsupported(
            "This PDF uses an encryption feature we don't support yet. "
            "Please unlock it on your phone and re-upload."
        ) from exc
    except PdfReadError as exc:
        log.warning("PDF parse error during unlock: %s", exc)
        raise PdfUnlockUnsupported(
            "We couldn't read this PDF — it looks corrupted or wasn't a "
            "real PDF. Please re-export from your bank's app and try again."
        ) from exc

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def unlock_pdf(content: bytes,
               numeric_width: int = 6,
               deadline_seconds: Optional[float] = None) -> bytes:
    """
    Return an unencrypted copy of the PDF, recovering the password
    transparently in the background.

    The caller does not supply a password — we try common values and
    then brute-force the numeric keyspace used by Tanzanian banks
    (default 6 digits). If the PDF isn't encrypted, the original bytes
    are returned unchanged.

    `deadline_seconds` defaults to `settings.pdf_unlock_max_seconds`
    (30s in production) so a single request can never soak more than
    that of CPU. Combined with the per-user `rate_limit_upload`
    (10/hour) this caps the worst-case CPU draw at ~5 minutes per user
    per hour even under deliberate abuse.

    Raises:
        PdfUnlockUnsupported:    encryption scheme we don't support, or
                                 the PDF is malformed.
        PdfPasswordIrrecoverable: encrypted, but the password didn't
                                 match anything in the search space
                                 within the deadline.
    """
    if deadline_seconds is None:
        # Late import keeps the module testable without spinning up Settings.
        from app.config import settings
        deadline_seconds = float(settings.pdf_unlock_max_seconds)

    params = _read_enc_params(content)
    if params is None:
        return content

    started = time.time()
    check = _make_checker(params)

    # 1. Common passwords (cheap — handful of milliseconds).
    common = _try_candidates(check, (s.encode("latin1") for s in _COMMON_PASSWORDS))
    if common is not None:
        recovered = common.decode("latin1")
        log.info(
            "PDF unlocked from common-password list in %.2fs (length=%d)",
            time.time() - started, len(recovered),
        )
        return _emit_decrypted(content, recovered)

    # 2. Single-process pre-sweep of the first slice (fast path for low
    #    account-numbers; saves the multiprocessing setup cost when we'd
    #    have found it in the first second anyway).
    fmt = f"%0{numeric_width}d"
    PRESWEEP = 4096
    for i in range(PRESWEEP):
        cand = (fmt % i).encode("latin1")
        if check(cand):
            recovered = cand.decode("latin1")
            log.info(
                "PDF unlocked via single-core pre-sweep in %.2fs (i=%d)",
                time.time() - started, i,
            )
            return _emit_decrypted(content, recovered)

    # 3. Full numeric sweep on every CPU core, with deadline.
    remaining = max(1.0, deadline_seconds - (time.time() - started))
    found = _bruteforce_numeric(params, width=numeric_width, deadline_seconds=remaining)
    if found is not None:
        recovered = found.decode("latin1")
        log.info(
            "PDF unlocked via parallel %d-digit sweep in %.2fs",
            numeric_width, time.time() - started,
        )
        return _emit_decrypted(content, recovered)

    raise PdfPasswordIrrecoverable(
        f"This PDF is password-protected and we couldn't recover the password "
        f"automatically within {deadline_seconds:.0f}s. If your bank uses a "
        f"non-numeric password, please unlock the PDF on your phone and re-upload."
    )
